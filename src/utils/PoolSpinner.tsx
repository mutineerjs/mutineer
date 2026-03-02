import { Box, Text } from 'ink'
import Spinner from 'ink-spinner'

interface PoolSpinnerProps {
  message: string
}

export function PoolSpinner({ message }: PoolSpinnerProps) {
  return (
    <Box>
      <Text color="cyan">
        <Spinner type="dots" />
      </Text>
      <Text> {message}</Text>
    </Box>
  )
}
