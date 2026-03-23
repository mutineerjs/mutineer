import path from 'node:path'
import { Box, Text, useInput, useApp } from 'ink'
import { useState, useEffect } from 'react'
import type { MutantCacheEntry } from '../types/mutant.js'

interface Props {
  entries: MutantCacheEntry[]
  cwd: string
}

export function EscapedTests({ entries, cwd }: Props) {
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
        <Text dimColor>Passing tests for escaped mutants:</Text>
        {entries.map((entry, i) => (
          <Box key={i} flexDirection="column">
            <Text>
              {'  '}
              {path.relative(cwd, entry.file)}@{entry.line},{entry.col}
              {'  '}
              <Text dimColor>{entry.mutator}</Text>
            </Text>
            {entry.passingTests?.map((t, j) => (
              <Text key={j} dimColor>
                {'    \u00b7 '}
                {t}
              </Text>
            ))}
          </Box>
        ))}
      </Box>
    )
  }

  return (
    <Box gap={2}>
      <Text dimColor>
        Passing test details for {entries.length} escaped mutant
        {entries.length === 1 ? '' : 's'}
      </Text>
      <Text dimColor>e expand  return skip</Text>
    </Box>
  )
}
