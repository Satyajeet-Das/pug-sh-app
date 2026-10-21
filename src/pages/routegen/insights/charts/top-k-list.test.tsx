import { create } from '@bufbuild/protobuf'
import { render, screen } from '@testing-library/react'
import { createStore, Provider } from 'jotai'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import {
  AggregationType,
  Granularity,
  InsightQuerySpecSchema,
  InsightType,
  TopKQuery_Dimension,
  TopKResultSchema,
  TopKRowSchema,
} from '@/api/genproto/shared/insights/v1/insights_pb'

vi.mock('@/api/rpc', async () => {
  const { atom } = await import('jotai')
  return { orgsRPCAtom: atom({}), projectsRPCAtom: atom({}), insightsRPCAtom: atom({}) }
})
vi.mock('@/components/charts/chart-parent-size', () => ({
  ParentSize: ({ children }: { children: (size: { width: number; height: number }) => ReactNode }) =>
    children({ width: 800, height: 300 }),
}))

const { TopKList } = await import('./top-k-list')
const { InsightTileView } = await import('../../dashboards/insight-tile-view')

const row = (dimensionValue: string) => create(TopKRowSchema, { dimensionValue, value: 10 })
const label = (value: string) => screen.getByTitle(value).textContent

describe('TopKList', () => {
  it('names the values of a coded property', () => {
    render(
      <TopKList
        rows={[row('IN')]}
        dimension={TopKQuery_Dimension.PROPERTY}
        property="$country"
        metric={AggregationType.TOTAL}
      />,
    )
    expect(label('IN')).toBe('India')
  })

  it.each([
    ['$country', 'US'],
    ['$locale', 'de'],
  ])('leaves event kinds alone when a %s ranking left its property behind', (property, kind) => {
    render(
      <TopKList
        rows={[row(kind)]}
        dimension={TopKQuery_Dimension.EVENT_KIND}
        property={property}
        metric={AggregationType.TOTAL}
      />,
    )
    expect(label(kind)).toBe(kind)
  })

  it('gets the property from a dashboard tile spec', () => {
    render(
      <Provider store={createStore()}>
        <InsightTileView
          spec={create(InsightQuerySpecSchema, {
            insightType: InsightType.TOP_K,
            topK: { dimension: TopKQuery_Dimension.PROPERTY, property: '$country', metric: AggregationType.TOTAL },
          })}
          result={{ case: 'topK', value: create(TopKResultSchema, { rows: [row('IN')] }) }}
          granularity={Granularity.DAY}
        />
      </Provider>,
    )
    expect(label('IN')).toBe('India')
  })
})
