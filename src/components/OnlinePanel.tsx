import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { online } from '../xa/online/session';
import { ONLINE_LEVELS, isBossLevel, levelTitle } from '../xa/online/levels';

/** Panel del modo online: crear/unirse a una sala, roster con colores y listo, votos de nivel y arranque. */
export default function OnlinePanel() {
  const s = useSyncExternalStore(online.subscribe, online.getState, online.getState);
  const linkCode = (new URLSearchParams(location.search).get('sala') ?? '').trim().toUpperCase();
  const [code, setCode] = useState(linkCode);
  const [copied, setCopied] = useState(false);
  const autoJoin = useRef(false);

  // ?sala=CODE: si ya hay un apodo guardado, entra directo
  useEffect(() => {
    if (autoJoin.current || !linkCode || s.phase !== 'menu') return;
    autoJoin.current = true;
    if (s.name) void online.join(linkCode);
  }, [linkCode, s.phase, s.name]);

  // el código que confirma el servidor manda sobre lo que se escribió
  useEffect(() => { if (s.code) setCode(s.code); }, [s.code]);

  const copyLink = async () => {
    const url = `${location.origin}${location.pathname}?sala=${s.code}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      window.prompt('Copiá el link para invitar a tus amigos:', url);
    }
  };

  const me = s.room?.players.find((p) => p.id === s.you);
  const ready = !!me?.ready;
  const host = s.host;
  const selected = s.room?.level ?? 0;
  const votes = new Map<number, number>();
  for (const v of s.room?.votes ?? []) votes.set(v.level, (votes.get(v.level) ?? 0) + 1);
  const allReady = !!s.room && s.room.players.filter((p) => p.online).every((p) => p.ready);
  const canStart = host && allReady && selected > 0 && s.room?.status === 'lobby';

  return (
    <div className="xa-online" onPointerDown={(e) => e.stopPropagation()}>
      <div className="xa-online-card">
        <header className="xa-online-head">
          <div className="xa-online-head-text">
            <strong>SALA ONLINE</strong>
            <small>Hasta {s.max} amigos · el anfitrión manda</small>
          </div>
          <span className={`xa-online-signal ${s.link === 'lost' ? 'is-lost' : s.direct ? 'is-direct' : ''}`} title={s.link === 'lost' ? 'reconectando…' : `${s.rtt || '—'} ms`} />
          <button className="xa-online-x" onClick={() => online.backToMenu()} title="Volver al menú">SALIR</button>
        </header>

        {!s.enabled && (
          <p className="xa-online-error">
            Este build no tiene servidor online configurado. Definí <code>PUBLIC_XA_BACKEND_URL</code> y{' '}
            <code>PUBLIC_XA_BACKEND_TOKEN</code> para habilitarlo.
          </p>
        )}

        {s.error && <p className="xa-online-error">{s.error}</p>}

        {s.enabled && (s.phase === 'menu' || s.phase === 'error') && (
          <section className="xa-online-menu">
            <label className="xa-online-label">
              Tu nombre
              <input
                className="xa-online-input"
                value={s.name}
                maxLength={10}
                placeholder="Máximo 10 caracteres"
                onChange={(e) => online.setName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && code.length === 5) void online.join(code); }}
              />
              <span className="xa-online-count">{s.name.length}/10</span>
            </label>

            <div className="xa-online-actions">
              <button className="xa-online-primary" disabled={!s.name} onClick={() => void online.create()}>
                CREAR SALA
              </button>
              {s.canResume && (
                <button className="xa-online-ghost" onClick={() => void online.resume()}>
                  RECUPERAR SESIÓN
                </button>
              )}
            </div>

            <div className="xa-online-or"><span>o unite con un código</span></div>

            <div className="xa-online-join">
              <input
                className="xa-online-input xa-online-code"
                value={code}
                maxLength={5}
                placeholder="ABC12"
                autoCapitalize="characters"
                autoComplete="off"
                onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5))}
                onKeyDown={(e) => { if (e.key === 'Enter' && code.length === 5) void online.join(code); }}
              />
              <button className="xa-online-primary" disabled={!s.name || code.length !== 5} onClick={() => void online.join(code)}>
                UNIRSE
              </button>
            </div>
            <p className="xa-online-hint">
              Compartí el link de la sala: el código queda cargado solo. El anfitrión elige el nivel; los demás votan.
            </p>
          </section>
        )}

        {s.enabled && s.phase === 'connecting' && (
          <section className="xa-online-wait">
            <span className="xa-online-spinner" aria-hidden="true" />
            <p>Conectando con la sala…</p>
          </section>
        )}

        {s.enabled && s.phase === 'playing' && (
          <section className="xa-online-wait">
            <p>La partida está en curso.</p>
            <button className="xa-online-ghost" onClick={() => online.backToMenu()}>SALIR DE LA PARTIDA</button>
          </section>
        )}

        {s.enabled && s.phase === 'lobby' && s.room && (
          <section className="xa-online-lobby">
            <div className="xa-online-room">
              <div>
                <span className="xa-online-kicker">CÓDIGO DE SALA</span>
                <strong className="xa-online-room-code">{s.room.code}</strong>
              </div>
              <button className="xa-online-ghost" onClick={() => void copyLink()}>
                {copied ? '¡COPIADO!' : 'COPIAR LINK'}
              </button>
              <span className={`xa-online-net ${s.link === 'lost' ? 'is-lost' : s.direct ? 'is-direct' : ''}`}>
                {s.link === 'lost' ? 'reconectando…' : `${s.rtt || '—'} ms · ${s.direct ? 'directo' : 'relay'}`}
              </span>
            </div>

            <div className="xa-online-players">
              {s.room.players.map((p) => {
                const hex = s.colors[p.color] ?? '#f4f0e6';
                return (
                  <div key={p.id} className={`xa-online-player ${p.id === s.you ? 'is-me' : ''}`}>
                    <span className="xa-online-dot" style={{ background: hex }} />
                    <span className="xa-online-name">{p.name.slice(0, 10) || 'Xa'}</span>
                    {p.host && <span className="xa-online-badge">HOST</span>}
                    {p.id === s.you && <span className="xa-online-badge is-you">VOS</span>}
                    <span className={`xa-online-ready ${p.ready ? 'is-on' : ''}`}>{p.ready ? 'LISTO' : 'ESPERA'}</span>
                    {!p.online && <span className="xa-online-off">sin conexión</span>}
                    {host && p.id !== s.you && (
                      <button className="xa-online-kick" title={`Sacar a ${p.name}`} onClick={() => online.kick(p.id)}>×</button>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="xa-online-mid">
              <button className={`xa-online-readybtn ${ready ? 'is-on' : ''}`} onClick={() => online.setReady(!ready)}>
                {ready ? 'CANCELAR LISTO' : 'ESTOY LISTO'}
              </button>
              <p className="xa-online-hint">
                {host
                  ? 'Cuando todos estén listos, elegí el nivel y empezá.'
                  : 'Cuando todos estén listos, el anfitrión puede empezar.'}
              </p>
            </div>

            <div className="xa-online-levels-head">
              <span className="xa-online-kicker">{host ? 'NIVEL ELEGIDO' : 'NIVEL ELEGIDO'}</span>
              <span className="xa-online-selected">
                {selected ? <>Nivel elegido: <b>{levelTitle(selected)}</b></> : 'Todavía no hay nivel elegido'}
              </span>
            </div>

            <div className="xa-online-levels">
              <div className="xa-online-levels-summary">
                {selected ? (
                  <div className="xa-online-level-card">
                    <span className="xa-online-level-num">{isBossLevel(selected) ? `E${selected - 100}` : selected}</span>
                    <span className="xa-online-level-title">{levelTitle(selected)}</span>
                    {isBossLevel(selected) && <span className="xa-online-boss">JEFE</span>}
                  </div>
                ) : (
                  <span className="xa-online-hint">El anfitrión todavía no eligió nivel.</span>
                )}
                {votes.size > 0 && (
                  <div className="xa-online-votes-list">
                    <span className="xa-online-kicker">VOTOS</span>
                    {Array.from(votes.entries()).map(([lvl, n]) => (
                      <span key={lvl} className="xa-online-vote-chip">{levelTitle(lvl)} · {n}</span>
                    ))}
                  </div>
                )}
              </div>
              <button
                className="xa-online-primary"
                disabled={host ? (!allReady) : false}
                title={host ? (allReady ? 'Elegir el nivel en el mapa del juego' : 'Primero todos deben estar listos') : 'Votá el nivel en el mapa del juego'}
                onClick={() => online.pickLevel()}
              >
                {host ? (allReady ? 'ELEGIR NIVEL EN EL MAPA' : 'FALTAN LISTOS') : 'VOTAR NIVEL EN EL MAPA'}
              </button>
              {!host && <p className="xa-online-hint">El anfitrión es quien inicia la partida; vos podés votar el nivel que más te guste.</p>}
            </div>

            <div className="xa-online-foot">
              <label className={`xa-online-toggle ${!host ? 'is-readonly' : ''}`}>
                <input
                  type="checkbox"
                  checked={isBossLevel(selected) ? true : s.settings.powerups}
                  disabled={!host || !selected || isBossLevel(selected)}
                  onChange={(e) => online.setPowerups(e.target.checked)}
                />
                Power-ups en los niveles originales
                {isBossLevel(selected) && <small> (contra los jefes van siempre)</small>}
              </label>
              {host ? (
                <button className="xa-online-start" disabled={!canStart} onClick={() => online.start()}>
                  {canStart ? 'EMPEZAR' : !selected ? 'ELEGÍ UN NIVEL' : !allReady ? 'FALTAN LISTOS' : 'EMPEZAR'}
                </button>
              ) : (
                <span className="xa-online-hint">El anfitrión inicia la partida.</span>
              )}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
