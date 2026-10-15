import { create, createRegistry } from '@bufbuild/protobuf'
import { createValidator } from '@bufbuild/protovalidate'
import type { GetFilterSchemaResponse, PropertyKeyMeta } from '@/api/genproto/common/v1/filter_schema_pb'
import { file_common_v1_filters, LogicalOperator, PropertyFilterSchema } from '@/api/genproto/common/v1/filters_pb'
import type { DashboardTile } from '@/api/genproto/dashboard/dashboards/v1/dashboards_pb'
import {
  FilterGroupSchema,
  type InsightQuerySpec,
  InsightQuerySpecSchema,
} from '@/api/genproto/shared/insights/v1/insights_pb'
import type { ActiveFilter } from '@/components/event-filters/filter-model'
import { toProtoFilters } from '@/components/event-filters/filter-proto'

const validator = createValidator({ registry: createRegistry(file_common_v1_filters) })

// The transport refuses a whole request over one invalid filter, so a bad dashboard filter would fail every tile.
export const isRunnableFilter = (filter: ActiveFilter) =>
  validator.validate(PropertyFilterSchema, create(PropertyFilterSchema, toProtoFilters([filter])[0])).kind === 'valid'

// Unscoped tiles add no kinds: intersecting every project event costs a request each and leaves almost nothing.
export const dashboardEventKinds = (tiles: DashboardTile[]) => {
  const kinds = tiles.flatMap(tile => {
    if (tile.content.case !== 'insight' || !tile.content.value.spec) return []
    const spec = tile.content.value.spec
    const scoped = spec.session ?? spec.userFlow ?? spec.topK ?? spec.map
    if (scoped) return [scoped.scope?.kind ?? '']
    return spec.events.map(entry => entry.event?.kind ?? '')
  })
  return [...new Set(kinds.filter(Boolean))].sort()
}

export const commonDashboardSchema = (base: GetFilterSchemaResponse, schemas: GetFilterSchemaResponse[]) => {
  if (schemas.length === 0) return base
  const common = (select: (schema: GetFilterSchemaResponse) => PropertyKeyMeta[]) =>
    select(schemas[0]).filter(key =>
      schemas.every(schema =>
        select(schema).some(other => other.name === key.name && other.valueType === key.valueType),
      ),
    )
  return {
    ...base,
    autoPropertyKeys: common(schema => schema.autoPropertyKeys),
    customPropertyKeys: common(schema => schema.customPropertyKeys),
  }
}

export const applyDashboardFilters = (spec: InsightQuerySpec | undefined, filters: readonly ActiveFilter[]) => {
  if (!spec || filters.length === 0) return spec
  const dashboardFilters = toProtoFilters(filters)
  const groups = spec.filterGroups.filter(group => group.filters.length > 0)
  // Another group under an outer OR would make the dashboard filters optional, so distribute them:
  // (A OR B) AND D becomes (A AND D) OR (B AND D).
  if (spec.filterGroupsOperator === LogicalOperator.OR && groups.length > 0) {
    return create(InsightQuerySpecSchema, {
      ...spec,
      filterGroups: groups.flatMap(group => {
        const terms = group.operator === LogicalOperator.OR ? group.filters.map(filter => [filter]) : [group.filters]
        return terms.map(term =>
          create(FilterGroupSchema, { operator: LogicalOperator.AND, filters: [...term, ...dashboardFilters] }),
        )
      }),
    })
  }
  return create(InsightQuerySpecSchema, {
    ...spec,
    filterGroupsOperator: LogicalOperator.AND,
    filterGroups: [...groups, create(FilterGroupSchema, { operator: LogicalOperator.AND, filters: dashboardFilters })],
  })
}
