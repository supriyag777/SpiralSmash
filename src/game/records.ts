export type BoardRow = { rank: number; playerId: string; displayName: string; score: number }
export type BoardData = { entries: BoardRow[]; myRank?: { rank: number; score: number } | null }
