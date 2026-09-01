import { useEffect, useRef, useState } from "react";
import { DEFAULT_SYNC_SERVER, normalizeServerUrl } from "@clingo-design/vfs";

import { setProjectSync, syncOf, useSyncState } from "../projects/store";
import { useDismiss } from "./useDismiss";
import styles from "./SyncSettings.module.css";

export interface SyncSettingsProps {
	/** The project's url — its identity, and what a collaborator is given. */
	url: string;
}

/**
 * Where this project syncs, and whether it is talking to it.
 *
 * ## The three states, and why the third one exists
 *
 * `off` is local: the documents are in this browser and have never left it.
 * `live` is a socket that is up. `waiting` is set to sync and not connected —
 * a server that is down, a laptop on a train, or a url with the right shape and
 * the wrong host.
 *
 * That third state is the whole reason this shows a live indicator instead of
 * only validating what was typed. `isValidServerUrl` can check the shape and
 * nothing more: subduction identifies a server by a hash of its own service
 * name and refuses a handshake whose audience does not match, and from inside a
 * browser that refusal is indistinguishable from silence. So a url can be
 * perfectly well-formed, accepted here, and never connect — and the only honest
 * way to say so is to report what is actually happening.
 *
 * ## Turning it on is the half that cannot be undone
 *
 * A project stays on the machine it was made on until this switch says
 * otherwise, and the switch is deliberately not a default: creating every
 * project in a syncing repo would publish it before anybody decided to, and
 * there is no unpublishing. Turning sync *off* again stops this device sending;
 * it does not retrieve what was sent. A document already on a server is on it,
 * and anyone holding the url still has it. The panel says that in those words,
 * because "stop syncing" reads like "undo" and is not.
 */
export function SyncSettings({ url }: SyncSettingsProps) {
	const [open, setOpen] = useState(false);
	const state = useSyncState(url);
	const current = syncOf(url);
	const [draft, setDraft] = useState(current.server ?? "");
	const [busy, setBusy] = useState(false);
	const host = useRef<HTMLDivElement>(null);
	useDismiss(host, () => setOpen(false), open);

	// The field follows the project when the panel is opened, not on every
	// render: a controlled input that re-read the setting while it was being
	// typed into would fight the person typing.
	useEffect(() => {
		if (open) setDraft(syncOf(url).server ?? "");
	}, [open, url]);

	const typed = draft.trim();
	const server = typed === "" ? null : normalizeServerUrl(typed);
	const malformed = typed !== "" && server === null;

	const apply = async (sync: boolean) => {
		if (malformed) return;
		setBusy(true);
		try {
			// A blank field means "the server this build was configured with", which
			// is what lets a deployment move without every project pinning itself to
			// an address. Passing the normalised form and not what was typed, because
			// that string keys the map of repos: two spellings of one server would be
			// two repos, two sockets and two sync paths for one place.
			await setProjectSync(url, sync, server ?? undefined);
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className={styles.host} ref={host}>
			<button
				type="button"
				className={styles.chip}
				data-role="sync"
				data-state={state}
				aria-expanded={open}
				title={
					state === "off"
						? "This project is only on this machine."
						: state === "live"
							? `Syncing to ${current.server}`
							: `Set to sync to ${current.server}, not connected`
				}
				onClick={() => setOpen((v) => !v)}
			>
				<span className={styles.dot} aria-hidden="true" />
				{state === "off" ? "Local" : state === "live" ? "Syncing" : "Offline"}
			</button>

			{open ? (
				<div className={styles.panel} data-role="sync-panel">
					<p className={styles.lead}>
						{state === "off"
							? "This project is on this machine only."
							: state === "live"
								? "Changes are being sent to the server as you make them."
								: "Set to sync, but not connected to the server right now."}
					</p>

					<label className={styles.field}>
						<span className={styles.label}>Server</span>
						<input
							className={styles.input}
							data-role="sync-server"
							value={draft}
							placeholder={DEFAULT_SYNC_SERVER ?? "wss://sync.example.com"}
							aria-invalid={malformed || undefined}
							onChange={(e) => setDraft(e.target.value)}
						/>
					</label>
					{malformed ? (
						<p className={styles.warn} data-role="sync-invalid">
							That is not a websocket address. It needs to start with{" "}
							<code>ws://</code> or <code>wss://</code>.
						</p>
					) : (
						<p className={styles.hint}>
							Blank uses whatever server this build was configured with, so a
							project follows the deployment instead of pinning itself to an
							address.
						</p>
					)}

					{current.sync ? (
						<>
							<button
								type="button"
								className={styles.action}
								data-role="sync-off"
								disabled={busy}
								onClick={() => void apply(false)}
							>
								Stop syncing
							</button>
							<p className={styles.hint}>
								Stops this device sending. It does not unsend: whatever reached
								the server is still there, and anyone with the link still has
								it.
							</p>
						</>
					) : (
						<>
							<button
								type="button"
								className={styles.action}
								data-role="sync-on"
								disabled={busy || malformed || (server === null && !DEFAULT_SYNC_SERVER)}
								onClick={() => void apply(true)}
							>
								Sync this project
							</button>
							<p className={styles.hint}>
								{server === null && !DEFAULT_SYNC_SERVER
									? "This build was configured with no server, so one has to be named here."
									: "Publishes the project to that server and keeps it in step. There is no unpublishing — anyone given the link can open it."}
							</p>
						</>
					)}
				</div>
			) : null}
		</div>
	);
}
