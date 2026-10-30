import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { online } from '../xa/online/session';
import { isBossLevel, levelTitle } from '../xa/online/levels';
import GameText from './GameText';
import './online.css';

type Tab = 'crear' | 'unirse';

/** El ?sala= se usa una sola vez por carga de página: tras SALIR el panel no vuelve a entrar solo. */
let linkConsumed = false;

const Crown = () => <img className="xo-crown" src="/online/crown.png" alt="Anfitrión" />;

/** Cabecita de Xa del color del jugador (items_tile.png + tinte por CSS) dentro del marco redondo (ver .xo-avatar). */
const Avatar = ({ hex, dim }: { hex: string; dim?: boolean }) => (
  <span className={`xo-avatar ${dim ? 'is-dim' : ''}`} style={{ '--hero': hex } as CSSProperties} aria-hidden="true"><i /></span>
);

/** Antena de conexión según el ping (ping_good / ping_mid / ping_bad); parpadea si se perdió. */
function Signal({ rtt, lost, direct }: { rtt: number; lost: boolean; direct: boolean }) {
  const q = lost ? 0 : !rtt ? 1 : rtt < 90 ? 3 : rtt < 180 ? 2 : 1;
  const label = lost ? 'Reconectando…' : `${rtt || '—'} ms · ${direct ? 'directo' : 'relay'}`;
  const img = q === 3 ? 'ping_good' : q === 2 ? 'ping_mid' : 'ping_bad';
  return (
    <span className={`xo-signal q${q} ${lost ? 'is-lost' : ''}`} title={label} role="img" aria-label={`Conexión: ${label}`}>
      <img src={`/online/${img}.png`} alt="" />
      <b>{label}</b>
    </span>
  );
}

/** Panel del modo online: pestañas CREAR / UNIRSE antes de entrar y SALA (lobby) adentro. */
export default function OnlinePanel() {
  const s = useSyncExternalStore(online.subscribe, online.getState, online.getState);
  const linkCode = (new URLSearchParams(location.search).get('sala') ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
  const [code, setCode] = useState(linkCode);
  const [tab, setTab] = useState<Tab>(linkCode ? 'unirse' : 'crear');
  const [copied, setCopied] = useState<'' | 'link' | 'code'>('');
  const autoJoin = useRef(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [, setTick] = useState(0);
  const awayDeadline = useRef(0);
  const cardRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  // el foco entra al panel al abrirse y vuelve a donde estaba al cerrarse
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    cardRef.current?.focus();
    return () => { before?.focus?.(); };
  }, []);
  useEffect(() => { if (confirmReset) cancelRef.current?.focus(); }, [confirmReset]);

  // ?sala=CODE: si ya hay un apodo guardado, entra directo
  useEffect(() => {
    if (autoJoin.current || linkConsumed || !linkCode || s.phase !== 'menu') return;
    autoJoin.current = true;
    linkConsumed = true;
    if (s.name) void online.join(linkCode);
  }, [linkCode, s.phase, s.name]);

  // cuenta regresiva para volver al nivel: el servidor manda los segundos que quedan con cada cambio de la sala
  const meAway = s.room?.players.find((p) => p.id === s.you)?.away;
  const seenRoom = useRef<unknown>(null);
  if (seenRoom.current !== s.room) { seenRoom.current = s.room; if (meAway !== undefined) awayDeadline.current = Date.now() + meAway * 1000; }
  useEffect(() => {
    if (meAway === undefined) return;
    const id = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [meAway]);
  useEffect(() => { if (!s.room) setConfirmLeave(false); }, [s.room]);

  // el código que confirma el servidor manda sobre lo que se escribió
  useEffect(() => { if (s.code) setCode(s.code); }, [s.code]);

  const copy = async (what: 'link' | 'code') => {
    const url = `${location.origin}${location.pathname}?sala=${s.code}`;
    try {
      await navigator.clipboard.writeText(what === 'link' ? url : s.code);
      setCopied(what);
      window.setTimeout(() => setCopied(''), 1800);
    } catch {
      window.prompt('Copiá esto para invitar a tus amigos:', what === 'link' ? url : s.code);
    }
  };

  const inRoom = s.phase === 'lobby' || s.phase === 'playing';
  const connecting = s.phase === 'connecting';
  const me = s.room?.players.find((p) => p.id === s.you);
  const ready = !!me?.ready;
  const host = s.host;
  const selected = s.room?.level ?? 0;
  const players = s.room?.players ?? [];
  const connected = players.filter((p) => p.online);
  const readyCount = connected.filter((p) => p.ready).length;
  // todos listos Y conectados (alguien sin conexión frena el arranque, igual que en el servidor)
  const allReady = !!s.room && players.length > 0 && players.every((p) => p.online && p.ready);
  const canStart = host && allReady && selected > 0 && s.room?.status === 'lobby';
  const slots = Math.max(s.max || 4, players.length);
  // fuera del nivel con la partida en curso: volver a jugar o mirar (con cuenta regresiva si salió del nivel)
  const outside = s.phase === 'lobby' && s.room?.status === 'playing';
  const awayLeft = me?.away === undefined ? null : Math.max(0, Math.ceil((awayDeadline.current - Date.now()) / 1000));
  const lost = s.link === 'lost';

  // votos por nivel, con quién votó cada uno
  const byLevel = new Map<number, number[]>();
  for (const v of s.room?.votes ?? []) byLevel.set(v.level, [...(byLevel.get(v.level) ?? []), v.id]);

  const nameOk = s.name.trim().length > 0;
  const codeOk = code.length === 5;
  const goJoin = () => { if (nameOk && codeOk) void online.join(code); };

  const tabs: { id: Tab | 'sala'; label: string; n: number; enabled: boolean }[] = [
    { id: 'crear', label: 'CREAR', n: 1, enabled: !inRoom && !connecting },
    { id: 'unirse', label: 'UNIRSE', n: 2, enabled: !inRoom && !connecting },
    { id: 'sala', label: 'SALA', n: 3, enabled: inRoom },
  ];
  const active: Tab | 'sala' = inRoom ? 'sala' : tab;

  return (
    <div className="xo" onPointerDown={(e) => e.stopPropagation()}>
      <div className="xo-card" ref={cardRef} role="dialog" aria-modal="true" aria-labelledby="xo-title" tabIndex={-1}>
        <header className="xo-head">
          <div className="xo-title">
            <strong id="xo-title"><GameText text="SALA ONLINE" font="black2" /></strong>
            <small>Hasta {s.max || 4} jugadores (con vos) · el anfitrión manda</small>
          </div>
          {inRoom && <Signal rtt={s.rtt} lost={lost} direct={s.direct} />}
          {inRoom ? (
            <button className="xo-btn xo-btn-exit is-room" onClick={() => setConfirmLeave(true)} title={host ? 'Cerrar la sala para todos' : 'Salir de la sala'}>
              <GameText text={host ? 'CERRAR SALA' : 'SALIR DE LA SALA'} font="white" />
            </button>
          ) : (
            <button className="xo-btn xo-btn-exit" onClick={() => online.backToMenu()} title="Volver al menú principal">
              <GameText text="SALIR" font="white" />
            </button>
          )}
        </header>
        {inRoom && confirmLeave && (
          <p className="xo-note is-error" role="alertdialog" aria-labelledby="xo-leave-title">
            <b id="xo-leave-title">{host ? '¿Cerrar la sala?' : '¿Salir de la sala?'}</b>{' '}
            {host ? 'Todos vuelven al menú principal.' : 'Volvés al menú principal; para volver tenés que entrar de nuevo con el código.'}
            <span className="xo-row">
              <button className="xo-btn xo-btn-small is-on" onClick={() => { setConfirmLeave(false); online.backToMenu(); }}>
                <GameText text={host ? 'SÍ, CERRAR' : 'SÍ, SALIR'} />
              </button>
              <button className="xo-btn xo-btn-small" autoFocus onClick={() => setConfirmLeave(false)}><GameText text="CANCELAR" /></button>
            </span>
          </p>
        )}

        <nav className="xo-tabs" role="tablist" aria-label="Pasos del modo online">
          {tabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              id={`xo-tab-${t.id}`}
              aria-selected={active === t.id}
              aria-controls="xo-panel"
              disabled={!t.enabled}
              tabIndex={active === t.id ? 0 : -1}
              className={`xo-tab ${active === t.id ? 'is-active' : ''}`}
              onClick={() => t.id !== 'sala' && setTab(t.id)}
              onKeyDown={(e) => {
                if (inRoom || connecting) return;
                if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                  e.preventDefault();
                  const next = tab === 'crear' ? 'unirse' : 'crear';
                  setTab(next);
                  document.getElementById(`xo-tab-${next}`)?.focus();
                }
              }}
            >
              <span className="xo-tab-n">{t.n}</span>
              <GameText text={t.label} />
            </button>
          ))}
        </nav>

        <div className="xo-body" id="xo-panel" role="tabpanel" aria-labelledby={`xo-tab-${active}`}>
          {!s.enabled && (
            <p className="xo-note is-error" role="alert">
              <b>Sin servidor.</b> Este build no tiene servidor online configurado. Definí <code>PUBLIC_XA_BACKEND_URL</code> y{' '}
              <code>PUBLIC_XA_BACKEND_TOKEN</code> para habilitarlo.
            </p>
          )}
          {s.error && (
            <p className="xo-note is-error" role="alert">
              <b>¡Ups!</b> {s.error}
            </p>
          )}

          {/* ---------------------------------------------------------- conectando */}
          {s.enabled && connecting && (
            <section className="xo-wait" aria-live="polite">
              <span className="xo-spinner" aria-hidden="true" />
              <p>{code ? <>Entrando a la sala <b>{code}</b>…</> : 'Conectando con la sala…'}</p>
              <button className="xo-btn" onClick={() => online.backToMenu()}><GameText text="CANCELAR" /></button>
            </section>
          )}

          {/* ---------------------------------------------------------- CREAR / UNIRSE */}
          {s.enabled && !inRoom && !connecting && (
            <section className="xo-menu">
              <label className="xo-field">
                <span className="xo-label">
                  <GameText text="TU NOMBRE" font="black2" /> <em>{s.name.length}/10</em>
                </span>
                <input
                  className="xo-input"
                  value={s.name}
                  maxLength={10}
                  placeholder="Tu apodo"
                  autoComplete="off"
                  aria-invalid={!nameOk}
                  onChange={(e) => online.setName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { if (tab === 'unirse') goJoin(); else if (nameOk) void online.create(); } }}
                />
                {!nameOk && <span className="xo-help">Escribí un apodo para poder seguir.</span>}
              </label>

              {tab === 'crear' ? (
                <div className="xo-pane">
                  <p className="xo-lead">
                    Creás la sala y sos el <b>anfitrión</b>: elegís el nivel en el mapa y la partida arranca cuando todos estén listos.
                  </p>
                  <ul className="xo-steps">
                    <li><b>1</b> Creá la sala</li>
                    <li><b>2</b> Pasá el código o el link</li>
                    <li><b>3</b> Todos listos, ¡a jugar!</li>
                  </ul>
                  <div className="xo-row">
                    <button className="xo-btn xo-btn-primary" disabled={!nameOk} onClick={() => void online.create()}>
                      <GameText text="CREAR SALA" />
                    </button>
                    {s.canResume && (
                      <button className="xo-btn" onClick={() => void online.resume()}><GameText text="RECUPERAR SESIÓN" /></button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="xo-pane">
                  {linkCode && (
                    <p className="xo-note is-info">Te invitaron a la sala <b>{linkCode}</b>.{!nameOk && ' Poné tu nombre para entrar.'}</p>
                  )}
                  <label className="xo-field">
                    <span className="xo-label"><GameText text="CÓDIGO DE SALA" font="black2" /></span>
                    <input
                      className="xo-input xo-code"
                      value={code}
                      maxLength={5}
                      placeholder="ABC12"
                      inputMode="text"
                      autoCapitalize="characters"
                      autoComplete="off"
                      spellCheck={false}
                      onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5))}
                      onKeyDown={(e) => { if (e.key === 'Enter') goJoin(); }}
                    />
                    <span className="xo-help">5 letras o números. También sirve abrir el link que te pasaron.</span>
                  </label>
                  <div className="xo-row">
                    <button className="xo-btn xo-btn-primary" disabled={!nameOk || !codeOk} onClick={goJoin}>
                      <GameText text="UNIRSE" />
                    </button>
                    {s.canResume && (
                      <button className="xo-btn" onClick={() => void online.resume()}><GameText text="RECUPERAR SESIÓN" /></button>
                    )}
                  </div>
                </div>
              )}
            </section>
          )}

          {/* ---------------------------------------------------------- SALA: partida en curso */}
          {s.enabled && s.phase === 'playing' && (
            <section className="xo-wait">
              <p>La partida está en curso.</p>
              <button className="xo-btn" onClick={() => online.backToMenu()}><GameText text="SALIR DE LA PARTIDA" /></button>
            </section>
          )}

          {/* ---------------------------------------------------------- SALA: fuera del nivel, la partida sigue */}
          {s.enabled && outside && s.room && (
            <section className="xo-wait" aria-live="polite">
              <p>La partida sigue en curso: <b>{isBossLevel(s.room.level) ? `E${s.room.level - 100}` : s.room.level} · {levelTitle(s.room.level)}</b>.</p>
              {awayLeft !== null && <p className="xo-note is-error">Si no volvés en {awayLeft} s, la partida termina para todos.</p>}
              <span className="xo-row">
                <button className="xo-btn xo-btn-primary" onClick={() => online.rejoin(false)}><GameText text="VOLVER A JUGAR" /></button>
                <button className="xo-btn" onClick={() => online.rejoin(true)}><GameText text="MIRAR" /></button>
              </span>
              <p className="xo-help">Mirando, elegís a quién seguir con las flechas o tocando la pantalla; Enter para entrar a jugar.</p>
            </section>
          )}

          {/* ---------------------------------------------------------- SALA: lobby */}
          {s.enabled && s.phase === 'lobby' && s.room && !outside && (
            <section className="xo-lobby">
              <div className="xo-room">
                <div className="xo-room-code">
                  <span className="xo-label"><GameText text="CÓDIGO DE SALA" font="black2" /></span>
                  <strong aria-live="polite"><GameText text={s.room.code} font="black2" /></strong>
                </div>
                <div className="xo-room-actions">
                  <button className="xo-btn xo-btn-small" onClick={() => void copy('code')}><GameText text={copied === 'code' ? '¡COPIADO!' : 'COPIAR CÓDIGO'} /></button>
                  <button className="xo-btn xo-btn-small" onClick={() => void copy('link')}><GameText text={copied === 'link' ? '¡COPIADO!' : 'COPIAR LINK'} /></button>
                </div>
              </div>

              <div>
                <div className="xo-sub">
                  <span className="xo-label"><GameText text="JUGADORES" font="black2" /></span>
                  <span className="xo-count">{connected.length}/{slots} · {readyCount} listos</span>
                </div>
                <ul className="xo-slots">
                  {Array.from({ length: slots }, (_, i) => {
                    const p = players[i];
                    if (!p) {
                      return (
                        <li key={`free${i}`} className="xo-slot is-free">
                          <span className="xo-avatar is-empty" aria-hidden="true"><i /></span>
                          <span className="xo-slot-main">
                            <span className="xo-name"><GameText text="LIBRE" font="white" /></span>
                            <span className="xo-state">Esperando a un amigo…</span>
                          </span>
                        </li>
                      );
                    }
                    const hex = s.colors[p.color] ?? '#f4f0e6';
                    const you = p.id === s.you;
                    return (
                      <li key={p.id} className={`xo-slot ${you ? 'is-me' : ''} ${!p.online ? 'is-off' : ''} ${p.ready ? 'is-ready' : ''}`} style={{ '--hero': hex } as CSSProperties}>
                        {/* color 0 (anfitrión): cabecita verde original, sin tinte; el dorado solo marca la casilla */}
                        <Avatar hex={p.color === 0 || p.host ? 'transparent' : hex} dim={!p.online} />
                        <span className="xo-slot-main">
                          <span className="xo-name">
                            {p.host && <Crown />}
                            <span className="xo-name-text"><GameText text={p.name.slice(0, 10) || 'Xa'} /></span>
                            {you && <span className="xo-tag">VOS</span>}
                          </span>
                          <span className={`xo-state ${p.ready ? 'is-on' : ''}`}>
                            {p.online && <img className="xo-ready-ico" src={`/online/${p.ready ? 'ready_on' : 'ready_off'}.png`} alt="" />}
                            {!p.online ? 'SIN CONEXIÓN' : p.ready ? 'LISTO' : 'ESPERANDO…'}
                          </span>
                        </span>
                        {host && !you && (
                          <button className="xo-kick" aria-label={`Sacar a ${p.name}`} title={`Sacar a ${p.name}`} onClick={() => online.kick(p.id)}>×</button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>

              <div className="xo-ready">
                {!host && (
                  <button className={`xo-btn xo-btn-big ${ready ? 'is-on' : 'xo-btn-primary'}`} aria-pressed={ready} onClick={() => online.setReady(!ready)}>
                    <GameText text={ready ? '¡LISTO! - CANCELAR' : 'ESTOY LISTO'} />
                  </button>
                )}
                <p className="xo-help">
                  {host
                    ? 'Cuando todos estén listos, tocá TODO LISTO: pasás a los menús del juego y los demás te ven moverte.'
                    : 'Cuando todos estén listos, el anfitrión toca TODO LISTO: vas a ver sus menús en tu pantalla y podés votar el nivel.'}
                </p>
              </div>

              <div className="xo-level">
                <div className="xo-sub">
                  <span className="xo-label"><GameText text="NIVEL" font="black2" /></span>
                  {isBossLevel(selected) && <span className="xo-tag is-boss">JEFE</span>}
                </div>
                {selected ? (
                  <div className="xo-level-card">
                    <span className="xo-level-num"><GameText text={isBossLevel(selected) ? `E${selected - 100}` : String(selected)} font="black2" /></span>
                    <span className="xo-level-title">{levelTitle(selected)}</span>
                  </div>
                ) : (
                  <div className="xo-level-card is-empty">
                    <span className="xo-level-title">Todavía no hay nivel elegido</span>
                  </div>
                )}
                {byLevel.size > 0 ? (
                  <ul className="xo-votes" aria-label="Votos">
                    {Array.from(byLevel.entries()).map(([lvl, ids]) => (
                      <li key={lvl} className="xo-vote">
                        <span className="xo-vote-dots">
                          {ids.map((id) => <i key={id} style={{ background: s.colors[players.find((p) => p.id === id)?.color ?? 0] }} title={players.find((p) => p.id === id)?.name} />)}
                        </span>
                        {isBossLevel(lvl) ? `E${lvl - 100}` : lvl} · {levelTitle(lvl)}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="xo-help">{host ? 'Nadie votó todavía.' : 'Votá el nivel en el mapa para que el anfitrión lo vea.'}</p>
                )}
                {host ? (
                  <button
                    className="xo-btn xo-btn-primary"
                    disabled={!allReady || lost}
                    title={allReady ? 'Pasar a los menús: los demás te miran y votan, vos elegís el nivel' : 'Primero todos deben estar listos'}
                    onClick={() => online.setBrowse(true)}
                  >
                    <GameText text={allReady ? '¡TODO LISTO!' : 'FALTAN LISTOS'} />
                  </button>
                ) : (
                  <p className="xo-help">El anfitrión elige el nivel en el mapa; vos votás cuando él lo abra.</p>
                )}
              </div>

              <div className="xo-level">
                <div className="xo-sub">
                  <span className="xo-label"><GameText text="PROGRESO" font="black2" /></span>
                  <span className="xo-count">
                    {s.menu ? `${s.menu.d.filter((n) => n <= 16).length}/16 originales · ${s.menu.d.filter((n) => n > 100).length}/16 extra` : '…'}
                  </span>
                </div>
                <p className="xo-help">Se juega con el progreso del anfitrión: sus niveles abiertos son los que se pueden elegir.</p>
                {host && !confirmReset && (
                  <button className="xo-btn xo-btn-small" onClick={() => setConfirmReset(true)}><GameText text="BORRAR PROGRESO" /></button>
                )}
                {host && confirmReset && (
                  <p className="xo-note is-error" role="alertdialog" aria-labelledby="xo-reset-title" aria-describedby="xo-reset-desc">
                    <b id="xo-reset-title">¿Borrar todo tu progreso?</b><span id="xo-reset-desc" hidden> Se pierden los niveles abiertos y los récords. </span> Se pierden los niveles abiertos y los récords de este navegador. No se puede deshacer.
                    <span className="xo-row">
                      <button className="xo-btn xo-btn-small is-on" onClick={() => { online.resetProgress(); setConfirmReset(false); }}><GameText text="SÍ, BORRAR" /></button>
                      <button ref={cancelRef} className="xo-btn xo-btn-small" onClick={() => setConfirmReset(false)}><GameText text="CANCELAR" /></button>
                    </span>
                  </p>
                )}
              </div>

              <div className="xo-foot">
                <label className={`xo-switch ${!host || isBossLevel(selected) ? 'is-locked' : ''}`}>
                  <input
                    type="checkbox"
                    checked={isBossLevel(selected) ? true : s.settings.powerups}
                    disabled={!host || !selected || isBossLevel(selected)}
                    onChange={(e) => online.setPowerups(e.target.checked)}
                  />
                  <span className="xo-switch-box" aria-hidden="true" />
                  <span className="xo-switch-text">
                    Power-ups en los niveles originales
                    <small>
                      {isBossLevel(selected)
                        ? 'Contra los jefes van siempre'
                        : !host ? 'Lo decide el anfitrión' : !selected ? 'Elegí un nivel primero' : s.settings.powerups ? 'Activados' : 'Apagados'}
                    </small>
                  </span>
                </label>
                {host ? (
                  canStart ? <button className="xo-btn xo-btn-go" onClick={() => online.start()}><GameText text="¡EMPEZAR!" /></button>
                    : <span className="xo-help">{!allReady ? 'Faltan jugadores por marcar listo.' : 'Tocá TODO LISTO para elegir el nivel.'}</span>
                ) : (
                  <span className="xo-help">El anfitrión inicia la partida.</span>
                )}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
