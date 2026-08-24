import { useMemo, useState } from "react";
import {
	EXPORT_TARGETS,
	EXPORT_TARGET_NAMES,
	type ExportTarget,
	type Scene,
	type Universe,
	collapseSpace,
	exportSpace,
	exportUniverse,
} from "@clingo-design/design-core";

import styles from "./ExportPanel.module.css";

export interface ExportPanelProps {
	scene: Scene;
	universes: readonly Universe[];
	/** Names the file and the document. */
	projectName: string;
}

/** The value the universe picker uses for "all of them, as one artefact". */
const WHOLE = "space";

/**
 * The way out, as one panel.
 *
 * Deliberately modest: exporting is not where the interest is. A target, which
 * design, whether to keep the token names, the text, and what the text does not
 * carry. The last of those is the part worth the space — an export always loses
 * something, and a panel that does not say what would be selling a lie.
 *
 * The universe picker's first entry is the whole space, and it is only offered
 * where the space actually collapses into one artefact; see `collapseSpace`.
 * Everywhere else the reason is shown beside the text, which is the honest
 * answer to "why did I get one design when the document holds fifteen".
 */
export function ExportPanel({ scene, universes, projectName }: ExportPanelProps) {
	const [target, setTarget] = useState<ExportTarget>("html");
	const [which, setWhich] = useState<string>(WHOLE);
	const [tokens, setTokens] = useState(true);
	const [copied, setCopied] = useState(false);

	const collapse = useMemo(
		() => collapseSpace(scene, universes),
		[scene, universes],
	);
	const collapsible = !("reason" in collapse);
	// A pick that no longer exists — the document changed under it — falls back
	// to the whole space rather than to nothing.
	const at = Number(which);
	const one = Number.isInteger(at) && at >= 0 && at < universes.length ? at : null;

	const result = useMemo(() => {
		const options = { target, tokens, title: projectName };
		if (universes.length === 0) return null;
		return one === null
			? exportSpace(scene, universes, options)
			: exportUniverse(scene, universes[one], options);
	}, [scene, universes, one, target, tokens, projectName]);

	function copy() {
		if (!result) return;
		void navigator.clipboard?.writeText(result.text);
		setCopied(true);
		setTimeout(() => setCopied(false), 1200);
	}

	return (
		<div className={styles.export} data-role="export">
			<div className={styles.controls}>
				<label className={styles.field}>
					Format
					<select
						className={styles.select}
						data-role="export-target"
						value={target}
						onChange={(e) => setTarget(e.target.value as ExportTarget)}
					>
						{EXPORT_TARGET_NAMES.map((name) => (
							<option key={name} value={name}>
								{EXPORT_TARGETS[name].label}
							</option>
						))}
					</select>
				</label>

				<label className={styles.field}>
					Design
					<select
						className={styles.select}
						data-role="export-universe"
						value={which}
						onChange={(e) => setWhich(e.target.value)}
					>
						{collapsible ? (
							<option value={WHOLE}>
								All {universes.length} — one {collapse.kind} on {collapse.label}
							</option>
						) : null}
						{universes.map((_, i) => (
							// eslint-disable-next-line react/no-array-index-key
							<option key={i} value={String(i)}>
								Design {i + 1} of {universes.length}
							</option>
						))}
					</select>
				</label>

				<label className={styles.check}>
					<input
						type="checkbox"
						data-role="export-tokens"
						checked={tokens}
						onChange={(e) => setTokens(e.target.checked)}
					/>
					Keep token names
				</label>

				<button
					type="button"
					className={styles.copy}
					data-role="export-copy"
					disabled={!result}
					onClick={copy}
				>
					{copied ? "Copied" : `Copy ${result?.filename ?? ""}`}
				</button>
			</div>

			<div className={styles.split}>
				<pre className={styles.text} data-role="export-text">
					{result?.text ?? "Nothing to export yet."}
				</pre>
				<div className={styles.aside}>
					<p className={styles.note} data-role="export-note">
						{result?.note}
					</p>
					<p className={styles.lostHead}>What this leaves behind</p>
					<ul className={styles.lost} data-role="export-lost">
						{(result?.lost ?? []).map((line) => (
							<li key={line}>{line}</li>
						))}
					</ul>
				</div>
			</div>
		</div>
	);
}
