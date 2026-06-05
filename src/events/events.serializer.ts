import type { Event, EventAddon } from '@prisma/client';

type EventWithAddons = Event & {
  addons?: EventAddon[];
  /** Populated by `EventsService.getAccessibleOrThrow`. Absent on list responses. */
  currentUserRole?: 'admin' | 'contributor' | 'observer';
};

/** Wire format for an event. BigInts → strings; dates → ISO. */
export function serializeEvent(event: EventWithAddons) {
  return {
    id: event.id,
    creatorId: event.creatorId,
    title: event.title,
    eventType: event.eventType,
    description: event.description,
    scheduledDate: event.scheduledDate ? event.scheduledDate.toISOString().slice(0, 10) : null,
    state: event.state,
    tierSlug: event.tierSlug,
    features: event.features,
    currency: event.currency,
    shareSlug: event.shareSlug,
    customSubdomain: event.customSubdomain,
    createdAt: event.createdAt.toISOString(),
    updatedAt: event.updatedAt.toISOString(),
    provisionedAt: event.provisionedAt?.toISOString() ?? null,
    publishedAt: event.publishedAt?.toISOString() ?? null,
    archivedAt: event.archivedAt?.toISOString() ?? null,
    addons: event.addons?.map((a) => ({ slug: a.addonSlug, createdAt: a.createdAt.toISOString() })) ?? [],
    ...(event.currentUserRole !== undefined && { currentUserRole: event.currentUserRole }),
  };
}
