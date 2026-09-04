import Link from "next/link";

export default function NotFound() {
  return (
    <main className="screen">
      <h1 className="title">Pagina non trovata</h1>
      <p className="lead">Il foglietto che cercavi non esiste.</p>
      <Link className="btn btn-primary" href="/">
        Torna alla home
      </Link>
    </main>
  );
}
