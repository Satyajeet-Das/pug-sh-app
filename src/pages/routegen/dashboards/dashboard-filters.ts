import { create } from '@bufbuild/protobuf'
import type { GetFilterSchemaResponse, PropertyKeyMeta } from '@/api/genproto/common/v1/filter_schema_pb'
import { LogicalOperator } from '@/api/genproto/common/v1/filters_pb'
import type { DashboardTile } from '@/api/genproto/dashboard/dashboards/v1/dashboards_pb'
import {
  FilterGroupSchema,
  type InsightQuerySpec,
  InsightQuerySpecSchema,
} from '@/api/genproto/shared/insights/v1/insights_pb'
import type { ActiveFilter } from '@/components/event-filters/filter-model'
import { toProtoFilters } from '@/components/event-filters/filter-proto'

// Unscoped session/flow/ranking/map tiles can use any event in the project.
export const dashboardEventKinds = (tiles: DashboardTile[], allKinds: string[]) => {
  const kinds = tiles.flatMap(tile => {
    if (tile.content.case !== 'insight' || !tile.content.value.spec) return []
    const spec = tile.content.value.spec
    const scoped = spec.session ?? spec.userFlow ?? spec.topK ?? spec.map
    if (scoped) return scoped.scope?.kind ? [scoped.scope.kind] : allKinds
    return spec.events.map(entry => entry.event?.kind ?? '').filter(Boolean)
  })
  return [...new Set(kinds)].sort()
}

export const commonDashboardSchema = (base: GetFilterSchemaResponse, schemas: GetFilterSchemaResponse[]) => {
  const common = (select: (schema: GetFilterSchemaResponse) => PropertyKeyMeta[]) => {
    if (schemas.length === 0) return []
    return select(schemas[0]).filter(key =>
      schemas.every(schema =>
        select(schema).some(other => other.name === key.name && other.valueType === key.valueType),
      ),
    )
  }
  return {
    ...base,
    autoPropertyKeys: common(schema => schema.autoPropertyKeys),
    customPropertyKeys: common(schema => schema.customPropertyKeys),
    profilePropertyKeys: base.profilePropertyKeys,
  }
}

// Conjoin with the saved predicate without changing it or weakening an OR expression.
// (A OR B) AND D becomes (A AND D) OR (B AND D).
export const applyDashboardFilters = (spec: InsightQuerySpec | undefined, filters: readonly ActiveFilter[]) => {
  if (!spec || filters.length === 0) return spec
  const dashboardFilters = toProtoFilters(filters)
  const groups = spec.filterGroups.filter(group => group.filters.length > 0)
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
