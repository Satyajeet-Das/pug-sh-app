export interface ChartPoint {
  date: Date
  values: number[]
  // Not reached yet: drawn empty, and the tooltip shows no value rather than a zero.
  pending?: boolean
}
