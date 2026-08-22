import { Link } from "react-router";

export function NotFound() {
	return (
		<section>
			<h1>404</h1>
			<p>
				No route matched. <Link to="/">Go home</Link>.
			</p>
		</section>
	);
}
