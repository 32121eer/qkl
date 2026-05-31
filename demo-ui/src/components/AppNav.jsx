import { NavLink } from 'react-router-dom';

function linkClassName({ isActive }) {
  return `app-nav-link${isActive ? ' active' : ''}`;
}

export default function AppNav() {
  return (
    <div className="app-nav-wrap">
      <nav className="app-nav" aria-label="演示页面导航">
        <NavLink to="/explorer" className={linkClassName}>
          区块链浏览器
        </NavLink>
        <NavLink to="/app-demo" className={linkClassName}>
          应用触发（调试）
        </NavLink>
        <NavLink to="/app-query" className={linkClassName}>
          跨链查询演示
        </NavLink>
        <NavLink to="/supply-chain" className={linkClassName}>
          供应链演示
        </NavLink>
      </nav>
    </div>
  );
}
