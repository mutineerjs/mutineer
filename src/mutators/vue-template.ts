import type { MutationOutput } from './types.js'

interface TemplateVueNode {
  type: number
  props?: TemplateVueProp[]
  children?: TemplateVueNode[]
}

interface TemplateVueProp {
  type: number
  name: string
  exp?: {
    loc: {
      start: { offset: number; line: number; column: number }
      end: { offset: number }
    }
  }
}

const ELEMENT_TYPE = 1
const DIRECTIVE_TYPE = 7

function walkDirectiveMutations(
  content: string,
  node: TemplateVueNode,
  nameFilter: (name: string) => boolean,
  outputs: MutationOutput[],
): void {
  for (const child of node.children ?? []) {
    if (child.type !== ELEMENT_TYPE) continue
    for (const prop of child.props ?? []) {
      if (prop.type !== DIRECTIVE_TYPE) continue
      if (!nameFilter(prop.name)) continue
      if (!prop.exp) continue
      const { start, end } = prop.exp.loc
      const expr = content.slice(start.offset, end.offset)
      outputs.push({
        line: start.line,
        col: start.column + 1,
        code:
          content.slice(0, start.offset) +
          `!(${expr})` +
          content.slice(end.offset),
      })
    }
    walkDirectiveMutations(content, child, nameFilter, outputs)
  }
}

export async function collectTemplateDirectiveMutations(
  content: string,
  directive: 'if' | 'show',
): Promise<MutationOutput[]> {
  const { parse } = await import('@vue/compiler-dom')
  const ast = parse(content) as TemplateVueNode
  const outputs: MutationOutput[] = []
  walkDirectiveMutations(content, ast, (name) => name === directive, outputs)
  return outputs
}

export async function collectTemplateBindingMutations(
  content: string,
): Promise<MutationOutput[]> {
  const { parse } = await import('@vue/compiler-dom')
  const ast = parse(content) as TemplateVueNode
  const outputs: MutationOutput[] = []
  walkDirectiveMutations(content, ast, (name) => name === 'bind', outputs)
  return outputs
}
