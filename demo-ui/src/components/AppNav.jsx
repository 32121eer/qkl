import { NavLink } from 'react-router-dom';

function linkClassName({ isActive }) {
  return `app-nav-link${isActive ? ' active' : ''}`;
}

export default function AppNav() {
  return (
    <div className="app-nav-wrap">
      <nav className="app-nav" aria-label="Demo Navigation">
        <NavLink to="/explorer" className={linkClassName}>
          Blockchain Explorer
        </NavLink>
        <NavLink to="/app-demo" className={linkClassName}>
          Application Demo
        </NavLink>
      </nav>
    </div>
  );
}
