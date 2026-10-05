import { ArrowUpRight, Mail } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { contactEmail, socialLinks } from './content/contact'

// Function to be at the top of every page when switching pages
export function ScrollToTop() {
    const { pathname } = useLocation()

    useEffect(() => {
        window.scrollTo(0, 0)
    }, [pathname])

    return null
}

// Display Contact links information
export function ContactLinks() {
    return <div className="contact-links">
        <a className="email-link" href={`mailto:${contactEmail}`}>
            <Mail size={16} /> {contactEmail} <ArrowUpRight size={14} />
        </a>
        <div className="social-links">
            {socialLinks.map(({ label, href, icon: Icon }) =>
                <a className="social-link" href={href} target="_blank" rel="noreferrer" aria-label={label} title={label} key={label}><Icon size={19} />
                </a>)}
        </div>
    </div>
}

// Display projects cards
export function ProjectCard({ project }) {
    return <a className="open-source-card" href={project.repo} target="_blank" rel="noreferrer">
        <div className="project-card-top">
            <span className="project-status">
                <span className="status-dot" /> {project.status}</span>
            <ArrowUpRight size={17} />
        </div>
        <h3>{project.name}</h3>
        <p>{project.description}</p>
        <span className="project-stack">{project.stack}</span>
    </a>
}

// Displays one row of writings
export function PostRow({ post }) {
    return <Link className="post-row" to={`/writing/${post.slug}`}>
        <div className="post-main">
            <span className="post-category">{post.category}</span>
            <div className="post-tags">{post.tags?.map((tag) =>
                <span key={tag}>#{tag}</span>)}
            </div>
            <h3>{post.title}</h3>
            <p>{post.excerpt}</p>
        </div>
        <span className="post-date">{post.date}<ArrowUpRight size={16} /></span>
    </Link>
}

// Displays the Table of content on blog posts
export function TableOfContents({ headings }) {
    const [activeHeading, setActiveHeading] = useState(headings[0]?.id ?? '')

    useEffect(() => {
        if (!headings.length) return undefined

        const updateActiveHeading = () => {
            const readingLine = 145
            const reachedHeading = headings
                .map((heading) => ({ id: heading.id, top: document.getElementById(heading.id)?.getBoundingClientRect().top ?? Infinity }))
                .filter((heading) => heading.top <= readingLine)
                .at(-1)

            setActiveHeading(reachedHeading?.id ?? headings[0].id)
        }

        updateActiveHeading()
        window.addEventListener('scroll', updateActiveHeading, { passive: true })
        window.addEventListener('resize', updateActiveHeading)
        return () => {
            window.removeEventListener('scroll', updateActiveHeading)
            window.removeEventListener('resize', updateActiveHeading)
        }
    }, [headings])

    if (!headings.length) return null

    return <aside className="article-toc" aria-label="Table of contents">
        <span className="eyebrow">On this page</span>
        <nav>
            <ul>{headings.map((heading) =>
                <li className={`toc-depth-${heading.depth}${activeHeading === heading.id ? ' is-active' : ''}`} key={heading.id}>
                    <a href={`#${heading.id}`} aria-current={activeHeading === heading.id ? 'location' : undefined}>{heading.text}</a>
                </li>)}
            </ul>
        </nav>
    </aside>
}