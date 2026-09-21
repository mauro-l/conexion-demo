import { PublicHeader } from '~/components/public/PublicHeader';

/** Public not-found experience. It never reveals whether the slug was unknown or unpublished. */
export default function NotFound() {
  return (
    <>
      <PublicHeader />
      <main className="page-main">
        <h1 className="hero-title">Página no encontrada</h1>
        <p className="tagline">El perfil que buscás no existe o no está publicado.</p>
      </main>
    </>
  );
}
