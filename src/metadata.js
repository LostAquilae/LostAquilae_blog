import { getPost } from './content/posts'

export function getPageMetadata(pathname) {
  if (pathname === '/') {
    return {
      title: "LostAquilae's blog",
      description: 'Cybersecurity research, projects, and technical writing by LostAquilae.',
    }
  }

  if (pathname === '/about') {
    return {
      title: 'About | LostAquilae',
      description: 'About LostAquilae, a cybersecurity researcher focused on offensive research.',
    }
  }

  if (pathname === '/writing') {
    return {
      title: 'Writing | LostAquilae',
      description: 'Technical write-ups about cybersecurity research and projects.',
    }
  }

  if (pathname === '/projects') {
    return {
      title: 'Projects | LostAquilae',
      description: 'Open-source projects by LostAquilae.',
    }
  }

  const postSlug = pathname.match(/^\/writing\/([^/]+)\/?$/)?.[1]
  const post = postSlug && getPost(postSlug)

  if (post) {
    return {
      title: `${post.title} | LostAquilae`,
      description: post.excerpt,
    }
  }

  return {
    title: 'Page not found | LostAquilae',
    description: "The page you're looking for could not be found.",
  }
}
