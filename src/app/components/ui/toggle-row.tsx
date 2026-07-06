export function ToggleRow({ label, description, name, defaultChecked }: {
  label: string; description: string; name: string; defaultChecked?: boolean;
}) {
  return (
    <label className="toggle-row">
      <span className="toggle-text"><b>{label}</b><span>{description}</span></span>
      <span className="switch"><input type="checkbox" name={name} defaultChecked={defaultChecked} /><span className="switch-track" /></span>
    </label>
  );
}
