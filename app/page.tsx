import type { Metadata } from 'next';
import { cache } from 'react';
import { notFound } from 'next/navigation';
import { PublicHeader } from '~/components/public/PublicHeader';
import { PublicHero } from '~/components/public/PublicHero';
import { PublicInfo } from '~/components/public/PublicInfo';
import { ServiceCatalog } from '~/components/public/ServiceCatalog';
import { loadPublicPageData, PublicApiError } from '~/lib/public-api.server';
import { getConfiguredSlug } from '~/lib/site-config.server';

/**
 * The slug is server-only configuration, so the route is resolved per request
 * rather than pre-rendered with a URL segment. The underlying public GETs still
 * carry a one-minute revalidation bound.
 */
export const dynamic = 'force-dynamic';

const loadLanding = cache(async () => {
  const slug = getConfiguredSlug();
  return loadPublicPageData(slug);
});

export async function generateMetadata(): Promise<Metadata> {
  try {
    const { context } = await loadLanding();
    return { title: `${context.barberia.name} | Reservá tu turno` };
  } catch {
    return { title: 'Conexión Barbería | Reservá tu turno' };
  }
}

export default async function PublicLandingPage() {
  const data = await loadLanding().catch((error: unknown) => {
    // Only a genuine not-found reaches the not-found experience. Any other
    // failure propagates to the 500 boundary.
    if (error instanceof PublicApiError && error.code === 'PUBLIC_RESOURCE_NOT_FOUND') {
      notFound();
    }
    throw error;
  });

  const { context, catalog } = data;

  return (
    <>
      <PublicHeader />
      <PublicHero barberia={context.barberia}>
        <PublicInfo barberia={context.barberia} />
      </PublicHero>
      <ServiceCatalog services={catalog.services} />
    </>
  );
}
