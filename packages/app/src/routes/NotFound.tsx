import { Link } from "react-router";

import styles from "./NotFound.module.css";

export function NotFound() {
	return (
		<section className={styles.notFound}>
			<h1>404</h1>
			<p>
				No route matched. <Link to="/">Go to the studio</Link>.
			</p>
		</section>
	);
}
