import RustyShell_part_1 from './posts/RustyShell-part-1/post.md?raw'
import RustyShell_part_1_image from './posts/RustyShell-part-1/images/RustyShell_part1_image.png'

import RustyShell_part_2 from './posts/RustyShell-part-2/post.md?raw'
import RustyShell_part_2_image from './posts/RustyShell-part-2/images/RustyShell_part2_image.png'

import RustyShell_part_3 from './posts/RustyShell-part-3/post.md?raw'
import RustyShell_part_3_image from './posts/RustyShell-part-3/images/RustyShell_part3_image.png'

export const posts = [
  {
    slug: 'RustyShell-part-3',
    title: 'RustyShell part 3: Leveraging LLVM IR for relative virtual table',
    excerpt: 'Using LLVM Pass to  modify Rust code at the LLVM IR level to make vtables relative and avoid relocations',
    date: 'September 30, 2026',
    readTime: '4 min read',
    category: 'Shellcode',
    tags: ['Rust', 'LLVM', 'Shellcode', 'CodeGeneration'],
    image: RustyShell_part_3_image,
    imageAlt: 'RustyShell crab with LLVM_IR relative vtable',
    content: RustyShell_part_3,
  },
  {
    slug: 'RustyShell-part-2',
    title: 'RustyShell part 2: the syntactic sugar',
    excerpt: 'Making writing shellcode easy and fluid',
    date: 'September 28, 2026',
    readTime: '3 min read',
    category: 'Shellcode',
    tags: ['Rust', 'Shellcode', 'Syntax'],
    image: RustyShell_part_2_image,
    imageAlt: 'RustyShell crab with syntactic sugar',
    content: RustyShell_part_2,
  },
  {
    slug: 'RustyShell-part-1',
    title: 'RustyShell part 1: the shellcode template',
    excerpt: 'Basic shellcode template in Rust to compile simply as position independent code',
    date: 'September 25, 2026',
    readTime: '2 min read',
    category: 'Shellcode',
    tags: ['Rust', 'Shellcode', 'Template'],
    image: RustyShell_part_1_image,
    imageAlt: 'RustyShell crab with Shellcode template',
    content: RustyShell_part_1,
  },
]

export function getPost(slug) {
  return posts.find((post) => post.slug === slug)
}
