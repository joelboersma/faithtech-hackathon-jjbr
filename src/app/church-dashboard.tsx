"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export type DashboardChurch = {
  id: string;
  name: string;
  location: string;
  baptisms2026: number;
  createdAt: string;
  updatedAt: string;
};

const number = new Intl.NumberFormat("en-US");
const date = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

export function ChurchDashboard({ churches, unavailable }: { churches: DashboardChurch[]; unavailable: boolean }) {
  const [query, setQuery] = useState("");
  const [refreshing, startTransition] = useTransition();
  const router = useRouter();
  const search = query.trim().toLocaleLowerCase();
  const filtered = churches.filter((church) => `${church.name} ${church.location}`.toLocaleLowerCase().includes(search));
  const baptisms = churches.reduce((total, church) => total + church.baptisms2026, 0);
  const locations = new Set(churches.map((church) => church.location.trim().toLocaleLowerCase())).size;

  return (
    <>
      <header className="site-header">
        <Link className="brand" href="/" aria-label="FaithTech home"><span className="brand-mark" aria-hidden="true">✦</span> FaithTech <span className="brand-divider">/</span> <span className="brand-label">Church network</span></Link>
        <span className="header-label">Together in faith.</span>
      </header>
      <main>
        <div className="page-heading">
          <div><p className="eyebrow">Our growing community</p><h1>Church dashboard</h1><p className="intro">A shared view of our churches and the lives being transformed.</p></div>
          <button className="refresh-button" disabled={refreshing} onClick={() => startTransition(() => router.refresh())}><span aria-hidden="true">↻</span> {refreshing ? "Refreshing…" : "Refresh data"}</button>
        </div>
        <section className="stats" aria-label="Network overview">
          <article className="stat-card"><p>Registered churches</p><strong>{unavailable ? "—" : number.format(churches.length)}</strong><span>Part of our church network</span></article>
          <article className="stat-card featured"><p>Baptisms in 2026</p><strong>{unavailable ? "—" : number.format(baptisms)}</strong><span>Reported across all churches</span></article>
          <article className="stat-card"><p>Locations represented</p><strong>{unavailable ? "—" : number.format(locations)}</strong><span>Unique registered locations</span></article>
        </section>
        <section className="directory" aria-labelledby="directory-heading" aria-busy={refreshing}>
          <div className="directory-toolbar">
            <div className="directory-title"><h2 id="directory-heading">Registered churches</h2>{!unavailable && <span className="count-badge">{number.format(churches.length)}</span>}</div>
            <div className="search-field"><span aria-hidden="true">⌕</span><input type="search" aria-label="Search churches by name or location" placeholder="Search name or location…" value={query} onChange={(event) => setQuery(event.target.value)} disabled={unavailable} /></div>
          </div>
          {unavailable ? (
            <div className="empty-state" role="alert"><h3>Church data is unavailable</h3><p>We couldn’t load the registered churches. Please try refreshing in a moment.</p></div>
          ) : churches.length === 0 ? (
            <div className="empty-state"><span className="empty-symbol" aria-hidden="true">✦</span><h3>A community starts with one church.</h3><p>No churches have registered yet. Churches will appear here once registration is complete.</p></div>
          ) : filtered.length === 0 ? (
            <div className="empty-state" role="status"><h3>No matching churches</h3><p>Try another church name or location.</p><button className="clear-button" onClick={() => setQuery("")}>Clear search</button></div>
          ) : (
            <div className="table-scroll"><table>
              <caption className="sr-only">Registered churches, locations, 2026 baptism totals, registration dates and last updated dates. Dates are shown in UTC.</caption>
              <thead><tr><th scope="col">Church</th><th scope="col">Location</th><th scope="col" className="numeric">Baptisms · 2026</th><th scope="col">Registered</th><th scope="col">Last updated</th></tr></thead>
              <tbody>{filtered.map((church) => (
                <tr key={church.id}>
                  <th scope="row"><div className="church-name"><span className="church-avatar" aria-hidden="true">{church.name.slice(0, 1).toLocaleUpperCase()}</span><span>{church.name}</span></div></th>
                  <td>{church.location}</td><td className="numeric baptism-total">{number.format(church.baptisms2026)}</td>
                  <td><time dateTime={church.createdAt}>{date.format(new Date(church.createdAt))}</time></td><td><time dateTime={church.updatedAt}>{date.format(new Date(church.updatedAt))}</time></td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
          {!unavailable && <div className="directory-footer" role="status">Showing {number.format(filtered.length)} of {number.format(churches.length)} registered churches<span>Reporting year 2026</span></div>}
        </section>
        <footer className="page-footer">Every church. Every story. One shared mission.</footer>
      </main>
    </>
  );
}
