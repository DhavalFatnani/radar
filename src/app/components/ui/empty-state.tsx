import { NavIcon, type NavIconName } from "@/app/components/shell/nav-icon";

export function EmptyState({
  icon,
  title,
  description,
}: {
  icon: NavIconName;
  title: string;
  description: string;
}) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon" aria-hidden="true">
        <NavIcon name={icon} />
      </div>
      <h2>{title}</h2>
      <p>{description}</p>
    </div>
  );
}
