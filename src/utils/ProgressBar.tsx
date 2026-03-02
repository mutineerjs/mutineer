import { Box, Text } from 'ink'

export interface ProgressBarProps {
  total: number
  done: number
  killed: number
  escaped: number
  errors: number
  timeouts: number
  skipped: number
  width?: number
}

export function ProgressBar({
  total,
  done,
  killed,
  escaped,
  errors,
  timeouts,
  skipped,
  width = 40,
}: ProgressBarProps) {
  const ratio = total === 0 ? 1 : Math.min(done / total, 1)
  const filled = Math.round(ratio * width)
  const bar = '\u2588'.repeat(filled) + '\u2591'.repeat(width - filled)
  const pct = Math.round(ratio * 100)

  return (
    <Box>
      <Text>
        mutants {done}/{total} [{bar}] {pct}%{' '}
      </Text>
      <Text color="green">killed={killed}</Text>
      <Text> </Text>
      <Text color="red">escaped={escaped}</Text>
      <Text> </Text>
      <Text color="yellow">errors={errors}</Text>
      <Text> </Text>
      <Text color="yellow">timeouts={timeouts}</Text>
      <Text> </Text>
      <Text dimColor>skipped={skipped}</Text>
    </Box>
  )
}
