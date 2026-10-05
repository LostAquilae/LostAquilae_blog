import { marked } from 'marked'
import markedAlert from 'marked-alert'
import hljs from 'highlight.js/lib/common'
import llvm from 'highlight.js/lib/languages/llvm'

// Highlighting configuration

// Function to color linker script code blocks
function linkerScript(hljs) {
  return {
    name: 'GNU Linker Script',
    keywords: { keyword: 'SECTIONS MEMORY PHDRS INCLUDE OUTPUT OUTPUT_FORMAT OUTPUT_ARCH SEARCH_DIR' },
    contains: [
      hljs.C_BLOCK_COMMENT_MODE,
      hljs.C_LINE_COMMENT_MODE,
      { className: 'function', begin: /\b(?:ENTRY|ALIGN|PROVIDE|KEEP|ASSERT|ORIGIN|LENGTH|ADDR|SIZEOF|LOADADDR)\b(?=\s*\()/ },
      { className: 'meta', begin: /\/(?:DISCARD|INFO|NOLOAD)\// },
      { className: 'title', begin: /\.[A-Za-z_][\w.]*/ },
      { className: 'variable', begin: /__[A-Za-z_]\w*__/ },
      { className: 'number', begin: /\b(?:0[xX][\da-fA-F]+|\d+)\b/ },
      { className: 'operator', begin: /[+?:<>|&!-]/ },
    ],
  }
}

hljs.registerLanguage('ld', linkerScript)

// Register llvm as highlighting language
hljs.registerLanguage('llvm', llvm)

// Enable github style alerts on Posts
marked.use(markedAlert())



// Posts rendering
const postImages = import.meta.glob('./content/posts/**/images/*', { eager: true, query: '?url', import: 'default' })

function headingId(text) {
  return text.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-')
}

export function getPostHeadings(content) {
  return marked.lexer(content).filter((token) => token.type === 'heading').map((token) => ({
    id: headingId(token.text),
    text: token.text,
    depth: token.depth,
  }))
}

function resolvePostImage(postSlug, source) {
  if (!source?.startsWith('./images/')) return source

  const imageName = source.slice('./images/'.length)
  return postImages[`./content/posts/${postSlug}/images/${imageName}`] ?? source
}

function resolveHtmlImageSources(html, postSlug) {
  return html.replace(/(<img\b[^>]*\bsrc\s*=\s*)(["'])([^"']+)(\2)/gi, (match, prefix, quote, source) => `${prefix}${quote}${resolvePostImage(postSlug, source)}${quote}`)
}

function escapeHtmlText(value) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function renderPostMarkdown(content, postSlug) {
  const renderer = new marked.Renderer()
  const defaultImageRenderer = renderer.image.bind(renderer)
  renderer.heading = ({ depth, text }) => `<h${depth} id="${headingId(text)}">${marked.parseInline(text)}</h${depth}>`
  renderer.code = ({ text, lang }) => {
    const language = lang?.trim().split(/\s+/)[0].toLowerCase()
    const highlighted = language && hljs.getLanguage(language)
      ? hljs.highlight(text, { language }).value
      : escapeHtmlText(text)
    const languageClass = language ? ` language-${language.replace(/[^a-z0-9_-]/g, '')}` : ''
    return `<pre class="code-block"><code class="hljs${languageClass}">${highlighted}</code></pre>`
  }
  renderer.image = (token) => defaultImageRenderer({ ...token, href: resolvePostImage(postSlug, token.href) })
  renderer.html = ({ text }) => resolveHtmlImageSources(text, postSlug)

  return marked.parse(content, { renderer })
}