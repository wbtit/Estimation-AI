import React, { useEffect, useState } from "react";
import { NameGate } from "./components/NameGate";
import { ProjectsScreen } from "./components/ProjectsScreen";
import { Workspace } from "./components/Workspace";
import { getWho, setWho } from "./lib/api";
import { parseRoute, routeHash, type Route } from "./lib/lf";

/** The review UI (Phase 11b): projects, then a project's workspace (Plans, BOM, Report). */
export const App: React.FC = () => {
  const [who, setWhoState] = useState(getWho());
  const [route, setRoute] = useState<Route>(parseRoute(window.location.hash));
  useEffect(() => {
    const on = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  const go = (r: Route) => {
    window.location.hash = routeHash(r);
  };
  if (!who)
    return (
      <NameGate
        onSubmit={(name) => {
          setWho(name);
          setWhoState(name);
        }}
      />
    );
  if (route.view === "projects")
    return (
      <ProjectsScreen
        onOpen={(id) =>
          go({ view: "workspace", projectId: id, tab: "plans", sheetId: null })
        }
      />
    );
  return <Workspace key={route.projectId} who={who} route={route} go={go} />;
};
