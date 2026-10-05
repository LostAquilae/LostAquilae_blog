import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { StaticRouter } from 'react-router-dom'
import { createServer } from 'vite'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outputDirectory = path.join(projectRoot, 'dist')
const vite = await createServer({
  configFile: path.join(projectRoot, 'vite.config.js'),
  appType: 'custom',
  server: { middlewareMode: true },
})

try {
  const [{ AppRoutes }, { posts }, { getPageMetadata }] = await Promise.all([
    vite.ssrLoadModule('/src/App.jsx'),
    vite.ssrLoadModule('/src/content/posts.js'),
    vite.ssrLoadModule('/src/metadata.js'),
  ])
  const template = await readFile(path.join(outputDirectory, 'index.html'), 'utf8')
  const routes = ['/', '/about', '/writing', '/projects', ...posts.map((post) => `/writing/${post.slug}`)]
    .map((routePath) => ({ path: routePath, ...getPageMetadata(routePath) }))
  routes.push({ path: '/not-found', outputFile: '404.html', ...getPageMetadata('/not-found') })

  for (const route of routes) {
    const appHtml = renderToString(
      createElement(StaticRouter, {
        basename: vite.config.base,
        location: `${vite.config.base.replace(/\/$/, '')}${route.path}`,
      }, createElement(AppRoutes)),
    )
    const html = template
      .replace('<div id="root"></div>', `<div id="root">${appHtml}</div>`)
      .replace(/<title>.*?<\/title>/, `<title>${escapeHtml(route.title)}</title>`)
      .replace(/<meta name="description" content=".*?" \/>/, `<meta name="description" content="${escapeHtml(route.description)}" />`)
    const routeDirectory = path.join(outputDirectory, route.path.replace(/^\/|\/$/g, ''))
    const outputPath = route.outputFile
      ? path.join(outputDirectory, route.outputFile)
      : route.path === '/'
        ? path.join(outputDirectory, 'index.html')
        : path.join(routeDirectory, 'index.html')

    await mkdir(path.dirname(outputPath), { recursive: true })
    await writeFile(outputPath, html)
  }
} finally {
  await vite.close()
}

function escapeHtml(value) {
  return value.replace(/[&"<>]/g, (character) => ({
    '&': '&amp;',
    '"': '&quot;',
    '<': '&lt;',
    '>': '&gt;',
  })[character])
}
