"use client";

import { Component, type ReactNode } from "react";

/** Keep the underlying static content when WebGL or a lazy scene fails. */
export default class MotionBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}
