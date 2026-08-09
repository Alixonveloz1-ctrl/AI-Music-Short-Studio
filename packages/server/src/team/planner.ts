import type { Beat, CameraMove, CreativeBrief, ProjectConfig, ShotType } from '@ams/shared';

/**
 * What a planner is given: the user's configuration plus the shot skeleton the
 * Producer already computed. The planner only writes the creative layer — it
 * never decides how many shots there are or how long they last, so the
 * duration maths cannot drift (PRD §12, §15).
 */
export interface PlannerInput {
  config: ProjectConfig;
  runtimeSec: number;
  shots: Array<{
    index: number;
    label: string;
    beat: Beat;
    shotType: ShotType;
    cameraMove: CameraMove;
    durationSec: number;
  }>;
}

export interface Planner {
  readonly name: 'claude' | 'heuristic';
  plan(input: PlannerInput): Promise<CreativeBrief>;
}
