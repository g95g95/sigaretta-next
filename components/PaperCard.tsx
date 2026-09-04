interface Props {
  children: React.ReactNode;
  /** foglietto in una lista: niente rotazione né ombra marcata */
  flat?: boolean;
  /** rimonta l'animazione di apertura quando cambia */
  unfoldKey?: string | number;
  className?: string;
}

export default function PaperCard({ children, flat, unfoldKey, className }: Props) {
  const classes = ["paper"];
  if (flat) classes.push("paper-flat");
  if (unfoldKey !== undefined) classes.push("paper-unfold");
  if (className) classes.push(className);

  return (
    <div key={unfoldKey} className={classes.join(" ")}>
      {children}
    </div>
  );
}
