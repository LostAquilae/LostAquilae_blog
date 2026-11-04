import { marked } from 'marked'
import markedAlert from 'marked-alert'
import { createHighlighterCore } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import c from 'shiki/langs/c.mjs'
import cpp from 'shiki/langs/cpp.mjs'
import llvm from 'shiki/langs/llvm.mjs'
import rust from 'shiki/langs/rust.mjs'
import darkPlus from 'shiki/themes/dark-plus.mjs'

const linkerScriptLanguage = {
  name: 'ld',
  scopeName: 'source.ld',
  patterns: [
    { name: 'comment.block.ld', begin: '/\\*', end: '\\*/' },
    { name: 'comment.line.double-slash.ld', match: '//.*$' },
    { name: 'keyword.control.ld', match: '\\b(?:SECTIONS|MEMORY|PHDRS|INCLUDE|OUTPUT|OUTPUT_FORMAT|OUTPUT_ARCH|SEARCH_DIR)\\b' },
    { name: 'support.function.ld', match: '\\b(?:ENTRY|ALIGN|PROVIDE|KEEP|ASSERT|ORIGIN|LENGTH|ADDR|SIZEOF|LOADADDR)\\b(?=\\s*\\()' },
    { name: 'constant.language.ld', match: '/(?:DISCARD|INFO|NOLOAD)/' },
    { name: 'entity.name.section.ld', match: '\\.[A-Za-z_][\\w.]*' },
    { name: 'variable.other.ld', match: '__[A-Za-z_]\\w*__' },
    { name: 'constant.numeric.ld', match: '\\b(?:0[xX][\\da-fA-F]+|\\d+)\\b' },
    { name: 'keyword.operator.ld', match: '[+?:<>|&!-]' },
  ],
}

const highlighter = await createHighlighterCore({
  engine: createJavaScriptRegexEngine(),
  themes: [darkPlus],
  langs: [c, cpp, llvm, rust, linkerScriptLanguage],
})

// Enable github style alerts on Posts
marked.use(markedAlert())



// Posts rendering
const postImages = import.meta.glob('./content/posts/**/images/*', { eager: true, query: '?url', import: 'default' })

function headingId(text) {
  return text.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-')
}

function createHeadingIdGenerator() {
  const headingCounts = new Map()
  return (text) => {
    const baseId = headingId(text)
    const count = headingCounts.get(baseId) ?? 0
    headingCounts.set(baseId, count + 1)
    return count === 0 ? baseId : `${baseId}-${count}`
  }
}

export function getPostHeadings(content) {
  const getUniqueHeadingId = createHeadingIdGenerator()
  return marked.lexer(content)
    .filter((token) => token.type === 'heading')
    .map((token) => ({
      id: getUniqueHeadingId(token.text),
      text: token.text,
      depth: token.depth,
    }))
    .filter((heading) => heading.depth < 4)
}

function resolvePostImage(postSlug, source) {
  if (!source?.startsWith('./images/')) return source

  const imageName = source.slice('./images/'.length)
  return postImages[`./content/posts/${postSlug}/images/${imageName}`] ?? source
}

function resolveHtmlImageSources(html, postSlug) {
  return html.replace(/(<img\b[^>]*\bsrc\s*=\s*)(["'])([^"']+)(\2)/gi, (match, prefix, quote, source) => `${prefix}${quote}${resolvePostImage(postSlug, source)}${quote}`)
}

export function renderPostMarkdown(content, postSlug) {
  const renderer = new marked.Renderer()
  const defaultImageRenderer = renderer.image.bind(renderer)
  const getUniqueHeadingId = createHeadingIdGenerator()
  renderer.heading = ({ depth, text }) => `<h${depth} id="${getUniqueHeadingId(text)}">${marked.parseInline(text)}</h${depth}>`
  renderer.code = ({ text, lang }) => {
    const language = lang?.trim().split(/\s+/)[0].toLowerCase()
    const supportedLanguage = highlighter.getLoadedLanguages().includes(language) ? language : 'text'
    return highlighter.codeToHtml(text, {
      lang: supportedLanguage,
      theme: 'dark-plus',
      transformers: [
        {
          pre(node) {
            node.properties.class = 'code-block shiki dark-plus'
          },
          code(node) {
            if (language) node.properties.className = [`language-${language.replace(/[^a-z0-9_-]/g, '')}`]
          },
        },
      ],
    })
  }
  renderer.image = (token) => defaultImageRenderer({ ...token, href: resolvePostImage(postSlug, token.href) })
  renderer.html = ({ text }) => resolveHtmlImageSources(text, postSlug)

  return marked.parse(content, { renderer })
}