import { NavLink, Outlet } from "react-router";

export function Layout() {
	return (
		<div className="layout">
			<header>
				<strong>Clingo Design</strong>
				<nav>
					<NavLink to="/" end>
						Home
					</NavLink>
					<NavLink to="/solver">Solver</NavLink>
					<NavLink to="/about">About</NavLink>
				</nav>
			</header>
			<main>
				<Outlet />
			</main>
		</div>
	);
}
