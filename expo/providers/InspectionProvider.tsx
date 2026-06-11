import AsyncStorage from "@react-native-async-storage/async-storage";
import createContextHook from "@nkzw/create-context-hook";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { AnalyzeResponse, Inspection } from "@/types/inspection";

const HISTORY_KEY = "palletpro.history.v1";
const MAX_HISTORY = 50;

/** Image staged on the Home screen and carried into the analysis flow. */
export type StagedImage = {
  uri: string;
  width: number;
  height: number;
};

async function loadHistory(): Promise<Inspection[]> {
  try {
    const raw = await AsyncStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Inspection[];
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.log("[InspectionProvider] failed to load history", err);
    return [];
  }
}

async function persistHistory(items: Inspection[]): Promise<void> {
  try {
    await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, MAX_HISTORY)));
  } catch (err) {
    console.log("[InspectionProvider] failed to persist history", err);
  }
}

export const [InspectionProvider, useInspection] = createContextHook(() => {
  const [staged, setStaged] = useState<StagedImage | null>(null);
  const [current, setCurrent] = useState<Inspection | null>(null);
  const [history, setHistory] = useState<Inspection[]>([]);

  const historyQuery = useQuery({
    queryKey: ["inspection-history"],
    queryFn: loadHistory,
  });

  useEffect(() => {
    if (historyQuery.data) {
      setHistory(historyQuery.data);
    }
  }, [historyQuery.data]);

  const stageImage = useCallback((image: StagedImage) => {
    setStaged(image);
  }, []);

  const clearStaged = useCallback(() => setStaged(null), []);

  const saveInspection = useCallback(
    (imageUri: string, result: AnalyzeResponse, source: Inspection["source"]) => {
      const inspection: Inspection = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        createdAt: Date.now(),
        imageUri,
        result,
        source,
      };
      setCurrent(inspection);
      setHistory((prev) => {
        const next = [inspection, ...prev].slice(0, MAX_HISTORY);
        void persistHistory(next);
        return next;
      });
      return inspection;
    },
    []
  );

  const clearHistory = useCallback(() => {
    setHistory([]);
    void persistHistory([]);
  }, []);

  return useMemo(
    () => ({
      staged,
      current,
      history,
      isHistoryLoading: historyQuery.isLoading,
      stageImage,
      clearStaged,
      saveInspection,
      setCurrent,
      clearHistory,
    }),
    [
      staged,
      current,
      history,
      historyQuery.isLoading,
      stageImage,
      clearStaged,
      saveInspection,
      clearHistory,
    ]
  );
});
