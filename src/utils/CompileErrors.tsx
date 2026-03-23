import path from 'node:path'
import { Box, Text, useInput, useApp } from 'ink'
import { useState, useEffect } from 'react'
import type { MutantCacheEntry } from '../types/mutant.js'

interface Props {
  entries: MutantCacheEntry[]
  cwd: string
}

export function CompileErrors({ entries, cwd }: Props) {
  const { exit } = useApp()
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    if (expanded) exit()
  }, [expanded, exit])

  useInput((input, key) => {
    if (input === 'e') {
      setExpanded(true)
    } else if (key.return || input === 'q') {
      exit()
    }
  })

  if (expanded) {
    return (
      <Box flexDirection="column">
        <Text dimColor>Compile Error Mutants (type-filtered):</Text>
        {entries.map((entry, i) => (
          <Text key={i} dimColor>
            {'  \u2022 '}
            {path.relative(cwd, entry.file)}@{entry.line},{entry.col}
            {'  '}
            {entry.mutator}
          </Text>
        ))}
      </Box>
    )
  }

  return (
    <Box gap={2}>
      <Text dimColor>
        Compile Error Mutants (type-filtered): {entries.length}
      </Text>
      <Text dimColor>e expand  return skip</Text>
    </Box>
  )
}
