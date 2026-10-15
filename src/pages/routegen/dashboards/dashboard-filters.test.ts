import { create } from '@bufbuild/protobuf'
import { describe, expect, it } from 'vitest'
import {
  GetFilterSchemaResponseSchema,
  PropertySource,
  PropertyValueType,
} from '@/api/genproto/common/v1/filter_schema_pb'
import { FilterOperator, LogicalOperator } from '@/api/genproto/common/v1/filters_pb'
import { DashboardTileSchema } from '@/api/genproto/dashboard/dashboards/v1/dashboards_pb'
import { type InsightQuerySpec, InsightQuerySpecSchema } from '@/api/genproto/shared/insights/v1/insights_pb'
import { createFilter } from '@/components/event-filters/filter-model'
import { applyDashboardFilters, commonDashboardSchema, dashboardEventKinds } from './dashboard-filters'

const tenant = createFilter('tenant', PropertySource.PROFILE, FilterOperator.IN, ['acme', 'other'])
const tile = (fields: Parameters<typeof create<typeof InsightQuerySpecSchema>>[1]) =>
  create(DashboardTileSchema, {
    content: { case: 'insight', value: { spec: create(InsightQuerySpecSchema, fields) } },
  })

describe('dashboard filter composition', () => {
  const evaluate = (spec: InsightQuerySpec, values: Record<string, boolean>) => {
    const groups = spec.filterGroups.map(group => {
      const predicates = group.filters.map(filter => values[filter.property ?? ''])
      return group.operator === LogicalOperator.OR ? predicates.some(Boolean) : predicates.every(Boolean)
    })
    return spec.filterGroupsOperator === LogicalOperator.OR ? groups.some(Boolean) : groups.every(Boolean)
  }

  it.each([LogicalOperator.AND, LogicalOperator.OR, LogicalOperator.UNSPECIFIED])(
    'requires dashboard filters in addition to existing groups (outer operator %s)',
    outer => {
      const spec = create(InsightQuerySpecSchema, {
        filterGroupsOperator: outer,
        filterGroups: [
          { operator: LogicalOperator.OR, filters: [{ property: 'a' }, { property: 'b' }] },
          { operator: LogicalOperator.AND, filters: [{ property: 'c' }, { property: 'd' }] },
        ],
        events: [{ event: { kind: 'purchase', filters: [{ property: 'amount', value: '100' }] } }],
      })
      const before = structuredClone(spec)
      const filtered = applyDashboardFilters(spec, [tenant])!
      for (let mask = 0; mask < 32; mask++) {
        const values = Object.fromEntries(
          ['a', 'b', 'c', 'd', 'tenant'].map((key, i) => [key, Boolean(mask & (1 << i))]),
        )
        expect(evaluate(filtered, values)).toBe(evaluate(spec, values) && values.tenant)
      }
      expect(spec).toEqual(before)
      expect(filtered.events).toEqual(spec.events)
    },
  )

  it('restores the original spec when cleared and handles tiles without saved filters', () => {
    const spec = create(InsightQuerySpecSchema)
    expect(applyDashboardFilters(spec, [])).toBe(spec)
    expect(applyDashboardFilters(undefined, [tenant])).toBeUndefined()
    expect(applyDashboardFilters(spec, [tenant])?.filterGroups[0].filters[0]).toMatchObject({
      property: 'tenant',
      source: PropertySource.PROFILE,
      values: ['acme', 'other'],
    })
  })
})

describe('shared dashboard properties', () => {
  it('intersects names and types separately for auto/custom properties and keeps profile traits', () => {
    const base = create(GetFilterSchemaResponseSchema, { profilePropertyKeys: [{ name: 'tenant' }] })
    const first = create(GetFilterSchemaResponseSchema, {
      autoPropertyKeys: [{ name: '$browser' }, { name: '$pathname' }],
      customPropertyKeys: [
        { name: 'shared' },
        { name: 'drift', valueType: PropertyValueType.INTEGER },
        { name: '$browser' },
      ],
    })
    const second = create(GetFilterSchemaResponseSchema, {
      autoPropertyKeys: [{ name: '$browser' }],
      customPropertyKeys: [{ name: 'shared' }, { name: 'drift', valueType: PropertyValueType.STRING }],
    })
    const schema = commonDashboardSchema(base, [first, second])
    expect(schema.autoPropertyKeys.map(key => key.name)).toEqual(['$browser'])
    expect(schema.customPropertyKeys.map(key => key.name)).toEqual(['shared'])
    expect(schema.profilePropertyKeys.map(key => key.name)).toEqual(['tenant'])
  })

  it('includes every funnel/retention event and scopes on non-event query types', () => {
    const tiles = [
      tile({ events: [{ event: { kind: 'signup' } }, { event: { kind: 'purchase' } }] }),
      tile({ session: { scope: { kind: 'page_view' } } }),
      tile({ topK: { scope: { kind: 'rank' } } }),
      tile({ map: { scope: { kind: 'visit' } } }),
      tile({ userFlow: { scope: { kind: 'flow' } } }),
      create(DashboardTileSchema, { content: { case: 'markdown', value: { body: 'text' } } }),
    ]
    expect(dashboardEventKinds(tiles, ['extra'])).toEqual(['flow', 'page_view', 'purchase', 'rank', 'signup', 'visit'])
    expect(dashboardEventKinds([...tiles, tile({ session: {} })], ['extra', 'signup'])).toContain('extra')
  })
})
