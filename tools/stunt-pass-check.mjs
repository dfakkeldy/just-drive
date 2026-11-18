// A stopped photograph cannot prove a traversal. Keep the completed motion receipt separate.
export const traversalGood=r=>r.completed===true&&Number.isFinite(r.end?.along)&&r.end.along>=r.farToe&&r.solidImpacts===0&&Number.isFinite(r.seconds)&&r.seconds>0&&r.seconds<=r.timeLimit;
