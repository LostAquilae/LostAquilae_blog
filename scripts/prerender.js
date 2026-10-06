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
  const [{ AppRoutes }, { posts }, { getPageMetadata }, { renderPostMarkdown }] = await Promise.all([
    vite.ssrLoadModule('/src/App.jsx'),
    vite.ssrLoadModule('/src/content/posts.js'),
    vite.ssrLoadModule('/src/metadata.js'),
    vite.ssrLoadModule('/src/markdown.js'),
  ])
  const siteUrl = `https://lostaquilae.github.io${vite.config.base.replace(/\/$/, '')}`
  const manifest = JSON.parse(await readFile(path.join(outputDirectory, '.vite/manifest.json'), 'utf8'))
  const imageUrls = Object.entries(manifest)
    .filter(([source]) => source.startsWith('src/content/posts/'))
    .map(([source, asset]) => [
      `${vite.config.base}${source}`,
      `${vite.config.base}${asset.file}`,
    ])
  const feedImageUrls = imageUrls.map(([sourceUrl, assetUrl]) => [
    sourceUrl,
    new URL(assetUrl.slice(vite.config.base.length), `${siteUrl}/`).href,
  ])
  const feedItems = posts.map((post) => {
    const pubDate = new Date(`${post.date} 00:00:00 UTC`)
    if (Number.isNaN(pubDate.getTime())) {
      throw new Error(`Invalid publication date for post "${post.slug}": ${post.date}`)
    }

    const postUrl = `${siteUrl}/writing/${post.slug}/`
    const articleHtml = feedImageUrls.reduce(
      (content, [sourceUrl, builtUrl]) => content.replaceAll(sourceUrl, builtUrl),
      renderPostMarkdown(post.content, post.slug),
    )
    const fullContent = `<h1>${escapeHtml(post.title)}</h1>
<p>${escapeHtml(post.excerpt)}</p>
${articleHtml}`
    return `    <item>
      <title>${escapeXml(post.title)}</title>
      <link>${escapeXml(postUrl)}</link>
      <guid isPermaLink="true">${escapeXml(postUrl)}</guid>
      <description>${escapeXml(post.excerpt)}</description>
      <pubDate>${pubDate.toUTCString()}</pubDate>
${(post.tags ?? []).map((tag) => `      <category>${escapeXml(tag)}</category>`).join('\n')}
      <content:encoded><![CDATA[${fullContent.replaceAll(']]>', ']]]]><![CDATA[>')}]]></content:encoded>
    </item>`
  }).join('\n')
  const rssFeed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>${escapeXml("LostAquilae's Blog")}</title>
    <link>${escapeXml(`${siteUrl}/`)}</link>
    <description>${escapeXml('Cybersecurity research, projects, and technical writing by LostAquilae.')}</description>
    <language>en</language>
${feedItems}
  </channel>
</rss>
`
  await writeFile(path.join(outputDirectory, 'rss.xml'), rssFeed)

  const template = await readFile(path.join(outputDirectory, 'index.html'), 'utf8')
  const routes = ['/', '/about/', '/writing/', '/projects/', ...posts.map((post) => `/writing/${post.slug}/`)]
    .map((routePath) => ({ path: routePath, ...getPageMetadata(routePath) }))
  routes.push({ path: '/not-found', outputFile: '404.html', ...getPageMetadata('/not-found') })

  for (const route of routes) {
    const appHtml = renderToString(
      createElement(StaticRouter, {
        basename: vite.config.base,
        location: `${vite.config.base.replace(/\/$/, '')}${route.path}`,
      }, createElement(AppRoutes)),
    )
    const html = imageUrls.reduce((content, [sourceUrl, builtUrl]) => content.replaceAll(sourceUrl, builtUrl), template
      .replace('<div id="root"></div>', `<div id="root">${appHtml}</div>`)
      .replace(/<title>.*?<\/title>/, `<title>${escapeHtml(route.title)}</title>`)
      .replace(/<meta name="description" content=".*?" \/>/, `<meta name="description" content="${escapeHtml(route.description)}" />`))
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

function escapeXml(value) {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&apos;',
  })[character])
}
