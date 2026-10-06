import { ArrowUpRight, ChevronLeft, Menu, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { BrowserRouter, Link, NavLink, Route, Routes, useLocation, useParams } from 'react-router-dom'
import { getPost, posts } from './content/posts'
import { openSourceProjects } from './content/projects'
import { ContactLinks, PostRow, ProjectCard, ScrollToTop, TableOfContents } from './Utils'
import { getPostHeadings, renderPostMarkdown } from './markdown'
import { getPageMetadata } from './metadata'
import './App.css'



// Header section
function Header() {
  const [menuOpen, setMenuOpen] = useState(false)
  const closeMenu = () => setMenuOpen(false)
  return <header className="site-header">
    <Link to="/" className="wordmark" onClick={closeMenu}>
      <img className="wordmark-logo" src={`${import.meta.env.BASE_URL}logo.jpg`} alt="LostAquilae logo" />
      <span>LostAquilae // Offensive Research</span>
    </Link>
    <button className="menu-toggle" type="button" onClick={() => setMenuOpen(!menuOpen)} aria-label="Toggle navigation">{menuOpen ? <X size={20} /> : <Menu size={20} />}</button>
    <nav className={menuOpen ? 'site-nav is-open' : 'site-nav'}>
      <NavLink to="/about/" onClick={closeMenu}>About me</NavLink>
      <NavLink to="/writing/" onClick={closeMenu}>Blog posts</NavLink>
      <NavLink to="/projects/" onClick={closeMenu}>Projects</NavLink>
      <a href="#contact" onClick={closeMenu}>Contact <ArrowUpRight size={14} /></a>
    </nav>
  </header>
}



// Footer Section
function Footer() {
  return <footer className="site-footer" id="contact">
    <div className="footer-meta">
      <p className="eyebrow">Contact</p>
      <ContactLinks />
      <span>© 2026 LostAquilae / 2026</span>
    </div>
  </footer>
}



// Home section
function Home() {
  const latestPost = posts[0]

  return <><section className="hero section-wrap">
    <div className="hero-kicker">
      <span className="status-dot" /> Status: Available for work
    </div>
    <div className="hero-main">
      <h1>Innovative<br /><em>Offensive Research</em></h1>
      <div className="hero-side">
        <p className="hero-intro">I’m LostAquilae, a cybersecurity researcher, focusing on offensive work.</p>
        <Link className="text-link" to="/about/">Read my profile <ArrowUpRight size={16} /></Link>
      </div>
    </div>
  </section>
    <section className="feature-band section-wrap">
      <div className="section-heading">
        <span className="eyebrow">Latest Blog</span>
      </div>
      <div className={latestPost.image ? 'project-feature has-image' : 'project-feature no-image'}>
        {latestPost.image && <div className="project-image">
          <img src={latestPost.image} alt={latestPost.imageAlt} />
        </div>}
        <div className="project-copy">
          {latestPost.image ? <>
            <span className="project-type">{latestPost.category} · {latestPost.date}</span>
            <h2>{latestPost.title}</h2>
            <p>{latestPost.excerpt}</p>
            <Link className="text-link" to={`/writing/${latestPost.slug}/`}>Read latest post <ArrowUpRight size={16} /></Link>
          </> : <>
            <div className="project-title-block">
              <span className="project-type">{latestPost.category} · {latestPost.date}</span>
              <h2>{latestPost.title}</h2>
            </div>
            <div className="project-description-block">
              <p>{latestPost.excerpt}</p>
              <Link className="text-link" to={`/writing/${latestPost.slug}/`}>Read latest post <ArrowUpRight size={16} /></Link>
            </div>
          </>}
        </div>
      </div>
    </section><OpenSourcePreview /><WritingPreview /></>
}

function OpenSourcePreview() {
  return <section className="open-source section-wrap">
    <div className="section-heading">
      <span className="eyebrow">Open-source projects</span>
      <Link className="text-link" to="/projects/">View all projects <ArrowUpRight size={16} /></Link>
    </div>
    <div className="open-source-grid">{openSourceProjects.slice(0, 3).map((project, index) => <ProjectCard key={`${project.name}-${index}`} project={project} />)}</div>
  </section>
}

function WritingPreview() {
  return <section className="writing-preview section-wrap">
    <div className="section-heading">
      <span className="eyebrow">From the notebook</span>
      <Link className="text-link" to="/writing/">View all writings <ArrowUpRight size={16} /></Link>
    </div>
    <div className="post-list">{posts.slice(1, 4).map((post) => <PostRow key={post.slug} post={post} />)}</div>
  </section>
}



// About Section
function About() {
  return <section className="about-page section-wrap page-intro">
    <div className="about-grid">
      <h1>About<br /><em>Me</em><br /></h1>
      <div className="about-copy">
        <p className="lede">I am a cybersecurity researcher, focusing on offensive work</p>
        <p>I am interested in malware development, reverse engineering, and everything regarding low-level research. This site showcases my work, projects and blog posts.</p>
        <a className="text-link" href="mailto:lostaquilae@protonmail.com">Start a conversation <ArrowUpRight size={16} /></a>
      </div>
    </div>
    <div className="about-details">
      <div>
        <span className="eyebrow">Currently</span>
        <p>Independent / Remote</p>
        <p>Available for work</p>
      </div>
      <div>
        <span className="eyebrow">Focus areas</span>
        <p>Maldev · Shellcode · Windows Internals</p>
      </div>
      <div className="about-contact">
        <span className="eyebrow">Contact</span>
        <ContactLinks />
      </div>
    </div>
  </section>
}



// Writing Section
function Writing() {
  const [selectedCategory, setSelectedCategory] = useState('All')
  const [selectedTag, setSelectedTag] = useState('All')
  const categories = ['All', ...new Set(posts.map((post) => post.category))]
  const tags = ['All', ...new Set(posts.flatMap((post) => post.tags ?? []))]
  const filteredPosts = posts.filter((post) => (selectedCategory === 'All' || post.category === selectedCategory) && (selectedTag === 'All' || post.tags?.includes(selectedTag)))

  return <section className="writing-page section-wrap page-intro">
    <div className="writing-title">
      <h1>Blog<br /><em>Posts</em></h1>
      <p className="lede">Technical write ups about my research and projects</p>
    </div>
    <div className="post-filter-layout">
      <div className="filter-group">
        <span className="eyebrow">Category filters</span>
        <div className="post-filters" role="group" aria-label="Filter blog posts by category">
          {categories.map((category) => <button className={selectedCategory === category ? 'filter-button is-active' : 'filter-button'} type="button" onClick={() => setSelectedCategory(category)} key={category}>{category === 'All' ? 'All posts' : category}</button>)}
        </div>
      </div>
      <div className="filter-group tag-filter-group">
        <span className="eyebrow">Tag filters</span>
        <div className="post-filters" role="group" aria-label="Filter blog posts by tag">
          {tags.map((tag) => <button className={selectedTag === tag ? 'filter-button is-active' : 'filter-button'} type="button" onClick={() => setSelectedTag(tag)} key={tag}>{tag === 'All' ? 'All tags' : `#${tag}`}</button>)}
        </div>
      </div>
    </div>
    <div className="post-list archive-list">{filteredPosts.map((post) => <PostRow key={post.slug} post={post} />)}</div>
  </section>
}



// Projects Section
function Projects() {
  return <section className="projects-page section-wrap page-intro">
    <div className="writing-title">
      <h1>Open Source<br /><em>Projects</em></h1>
      <p className="lede">List of all my current and passed projects I have been working on</p>
    </div>
    <div className="open-source-grid project-archive">{openSourceProjects.map((project) => <ProjectCard key={project.name} project={project} />)}</div>
  </section>
}



// Posts Section
function Post() {
  const { slug } = useParams()
  const post = getPost(slug)

  if (!post) return <NotFound />

  const headings = getPostHeadings(post.content)
  const currentIndex = posts.findIndex((item) => item.slug === slug)
  const prevPost = currentIndex < posts.length - 1 ? posts[currentIndex + 1] : null
  const nextPost = currentIndex > 0 ? posts[currentIndex - 1] : null

  return <article className="article section-wrap">
    <Link className="back-link" to="/writing/"><ChevronLeft size={16} /> All writing</Link>
    <div className="article-header">{post.image && <img className="article-image" src={post.image} alt={post.imageAlt || ''} />}<span className="eyebrow">{post.category} · {post.date}</span><h1>{post.title}</h1><p>{post.excerpt}</p>{post.tags?.length > 0 && <div className="post-tags article-tags" aria-label="Post tags">{post.tags.map((tag) => <span key={tag}>#{tag}</span>)}</div>}</div>
    <div className="article-body">
      <div className="markdown" dangerouslySetInnerHTML={{ __html: renderPostMarkdown(post.content, post.slug) }} />
      <TableOfContents headings={headings} />
    </div>
    <nav className={`post-nav ${prevPost ? '' : 'post-nav-single-next'}`} aria-label="More posts">
      {prevPost && <Link className="post-nav-link post-nav-link-prev" to={`/writing/${prevPost.slug}/`}>
        <span className="post-nav-label">Previous</span>
        <span className="post-nav-title">{prevPost.title}</span>
      </Link>}
      {nextPost && <Link className="post-nav-link post-nav-link-next" to={`/writing/${nextPost.slug}/`}>
        <span className="post-nav-label">Next</span>
        <span className="post-nav-title">{nextPost.title}</span>
      </Link>}
    </nav>
  </article>
}



// App Section
function NotFound() {
  return <section className="section-wrap not-found">
    <span className="eyebrow">404 · Not found</span>
    <h2>The page you’re looking for doesn’t exist or may have moved.</h2>
    <Link className="text-link" to="/">Back to home <ArrowUpRight size={16} /></Link>
  </section>
}

function Layout({ children }) { return <><Header /><main>{children}</main><Footer /></> }

export function AppRoutes() {
  const { pathname } = useLocation()
  const { title, description } = getPageMetadata(pathname)

  useEffect(() => {
    document.title = title
    document.querySelector('meta[name="description"]')?.setAttribute('content', description)
  }, [title, description])

  return <>
    <ScrollToTop />
    <Layout>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/about" element={<About />} />
        <Route path="/writing" element={<Writing />} />
        <Route path="/projects" element={<Projects />} />
        <Route path="/writing/:slug" element={<Post />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Layout>
  </>
}

function App() {
  return <BrowserRouter basename={import.meta.env.BASE_URL}>
    <AppRoutes />
  </BrowserRouter>
}

export default App
