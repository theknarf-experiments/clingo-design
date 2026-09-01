import { componentPath } from "@clingo-design/design-core";

import { deleteComponent, useComponents } from "../projects/store";
import styles from "./Components.module.css";

export interface ComponentsProps {
	url: string;
	/** Make a component out of what is selected, if anything is. */
	canExtract: boolean;
	onExtract: () => void;
	/** Put an instance of one on the page being shown. */
	onPlace: (path: string) => void;
}

/**
 * The project's components, beside its pages.
 *
 * Each one is its own Automerge document, which is what puts it here rather
 * than in the layer list: a component does not belong to the page you happen to
 * be looking at. It belongs to the project, every page can use it, and editing
 * it from any of them changes it everywhere.
 *
 * That is also why there is no "open" here yet, and its absence is a decision
 * rather than an omission — see the note on the header.
 */
export function Components({ url, canExtract, onExtract, onPlace }: ComponentsProps) {
	const names = useComponents(url);

	return (
		<section className={styles.host} data-role="components">
			<header className={styles.head}>
				<span className={styles.title}>Components</span>
				{/*
				  * Made from a selection rather than from nothing, because a component
				  * is a thing you have already drawn. The button is disabled rather
				  * than hidden when nothing is selected: it is the only route to a
				  * component, and a control that vanishes teaches nobody it exists.
				  */}
				<button
					type="button"
					className={styles.add}
					data-role="make-component"
					aria-label="Make a component from the selection"
					title={
						canExtract
							? "Move this into its own document. Every page can use it, and editing it changes them all."
							: "Select something to make a component of it"
					}
					disabled={!canExtract}
					onClick={onExtract}
				>
					+
				</button>
			</header>

			{names.length === 0 ? (
				<p className={styles.empty}>
					Nothing yet. Select something and press + to make it a component.
				</p>
			) : (
				<ul className={styles.list}>
					{names.map((name) => (
						<li key={name}>
							<div className={styles.row} data-component={name}>
								<button
									type="button"
									className={styles.name}
									title="Place an instance on this page"
									onClick={() => onPlace(componentPath(name))}
								>
									{name}
								</button>
								<button
									type="button"
									className={styles.remove}
									data-role="delete-component"
									aria-label={`Delete ${name}`}
									title="Delete this component. Instances of it stay where they are and stop drawing."
									onClick={() => {
										if (
											!confirm(
												`Delete “${name}”? Anything using it will stop drawing, but stays where it is.`,
											)
										) {
											return;
										}
										void deleteComponent(url, name);
									}}
								>
									×
								</button>
							</div>
						</li>
					))}
				</ul>
			)}
		</section>
	);
}
