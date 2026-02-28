#!/usr/bin/env python3
"""
Attractor - Software Factory Pipeline Executor

Native Python implementation of StrongDM's Attractor pattern for NanoClaw.
"""

import json
import re
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Dict, List, Optional, Set
import sys


class NodeShape(Enum):
    """Node shapes determine execution behavior"""
    BOX = "box"  # LLM task
    HEXAGON = "hexagon"  # Human gate
    DIAMOND = "diamond"  # Conditional
    PARALLELOGRAM = "parallelogram"  # Shell command
    MDIAMOND = "Mdiamond"  # Start
    MSQUARE = "Msquare"  # Exit


@dataclass
class Node:
    """Represents a task node in the pipeline"""
    id: str
    label: str
    shape: NodeShape = NodeShape.BOX
    prompt: Optional[str] = None
    cmd: Optional[str] = None
    completed: bool = False


@dataclass
class Edge:
    """Represents a dependency edge"""
    from_node: str
    to_node: str
    label: Optional[str] = None
    condition: Optional[str] = None


@dataclass
class Pipeline:
    """Pipeline execution graph"""
    goal: str
    nodes: Dict[str, Node] = field(default_factory=dict)
    edges: List[Edge] = field(default_factory=list)
    context: Dict[str, any] = field(default_factory=dict)


class DOTParser:
    """Parse GraphViz DOT format into Pipeline"""

    def parse(self, dot_content: str) -> Pipeline:
        """Parse DOT string into Pipeline object"""
        # Extract graph goal
        goal_match = re.search(r'graph\s*\[\s*goal\s*=\s*"([^"]+)"', dot_content)
        goal = goal_match.group(1) if goal_match else "Execute pipeline"

        pipeline = Pipeline(goal=goal)

        # Parse nodes
        node_pattern = r'(\w+)\s*\[(.*?)\]'
        for match in re.finditer(node_pattern, dot_content):
            node_id = match.group(1)
            attributes = match.group(2)

            # Skip graph attributes
            if node_id in ['graph', 'node', 'edge']:
                continue

            # Parse node attributes
            label_match = re.search(r'label\s*=\s*"([^"]+)"', attributes)
            shape_match = re.search(r'shape\s*=\s*(\w+)', attributes)
            prompt_match = re.search(r'prompt\s*=\s*"([^"]+)"', attributes)
            cmd_match = re.search(r'cmd\s*=\s*"([^"]+)"', attributes)

            label = label_match.group(1) if label_match else node_id
            shape_str = shape_match.group(1) if shape_match else "box"

            try:
                shape = NodeShape(shape_str)
            except ValueError:
                shape = NodeShape.BOX

            node = Node(
                id=node_id,
                label=label,
                shape=shape,
                prompt=prompt_match.group(1) if prompt_match else None,
                cmd=cmd_match.group(1) if cmd_match else None
            )
            pipeline.nodes[node_id] = node

        # Parse edges
        edge_pattern = r'(\w+)\s*->\s*(\w+)\s*(?:\[(.*?)\])?'
        for match in re.finditer(edge_pattern, dot_content):
            from_node = match.group(1)
            to_node = match.group(2)
            attributes = match.group(3) or ""

            label_match = re.search(r'label\s*=\s*"([^"]+)"', attributes)
            condition_match = re.search(r'condition\s*=\s*"([^"]+)"', attributes)

            edge = Edge(
                from_node=from_node,
                to_node=to_node,
                label=label_match.group(1) if label_match else None,
                condition=condition_match.group(1) if condition_match else None
            )
            pipeline.edges.append(edge)

        return pipeline


class PipelineExecutor:
    """Execute pipeline using NanoClaw agents"""

    def __init__(self, checkpoint_dir: Path):
        self.checkpoint_dir = checkpoint_dir
        self.checkpoint_dir.mkdir(parents=True, exist_ok=True)

    def get_ready_nodes(self, pipeline: Pipeline) -> List[Node]:
        """Get nodes ready to execute (dependencies satisfied)"""
        # Find nodes with no incomplete predecessors
        ready = []
        for node_id, node in pipeline.nodes.items():
            if node.completed:
                continue

            # Check if all predecessors are complete
            predecessors = [e.from_node for e in pipeline.edges if e.to_node == node_id]
            if all(pipeline.nodes.get(pred, Node(id=pred, label=pred)).completed for pred in predecessors):
                ready.append(node)

        return ready

    def save_checkpoint(self, pipeline: Pipeline, checkpoint_id: str):
        """Save pipeline state for resume"""
        checkpoint_file = self.checkpoint_dir / f"{checkpoint_id}.json"
        data = {
            "goal": pipeline.goal,
            "context": pipeline.context,
            "completed_nodes": [node_id for node_id, node in pipeline.nodes.items() if node.completed]
        }
        checkpoint_file.write_text(json.dumps(data, indent=2))

    def load_checkpoint(self, checkpoint_id: str) -> Optional[Dict]:
        """Load saved checkpoint"""
        checkpoint_file = self.checkpoint_dir / f"{checkpoint_id}.json"
        if checkpoint_file.exists():
            return json.loads(checkpoint_file.read_text())
        return None

    def execute_node(self, node: Node, pipeline: Pipeline) -> bool:
        """Execute a single node. Returns True if successful."""
        print(f"\n{'='*60}")
        print(f"Executing: {node.label}")
        print(f"Shape: {node.shape.value}")
        print(f"{'='*60}\n")

        if node.shape == NodeShape.MDIAMOND:
            # Start node - always succeeds
            print("Start node - beginning pipeline")
            return True

        elif node.shape == NodeShape.MSQUARE:
            # Exit node - always succeeds
            print("Exit node - pipeline complete")
            return True

        elif node.shape == NodeShape.BOX:
            # LLM task - output agent spawn command
            print(f"LLM Task: {node.label}")
            print(f"Prompt: {node.prompt}\n")
            print(f"# To execute this node, spawn an agent:")
            print(f"# Task tool with prompt: \"{node.prompt}\"")
            print(f"# Context: {pipeline.context}")
            return True

        elif node.shape == NodeShape.PARALLELOGRAM:
            # Shell command - output bash command
            print(f"Shell Command: {node.cmd}")
            print(f"# To execute: Bash tool with command: \"{node.cmd}\"")
            return True

        elif node.shape == NodeShape.HEXAGON:
            # Human gate - request approval
            print(f"Human Approval Required: {node.label}")
            print(f"# Send message to user and wait for response")
            print(f"# Options: [Approve, Reject]")
            return True

        elif node.shape == NodeShape.DIAMOND:
            # Conditional - evaluate context
            print(f"Conditional Node: {node.label}")
            print(f"# Evaluate condition based on pipeline context")
            return True

        return False


def main():
    """CLI entry point"""
    if len(sys.argv) < 2:
        print("Usage: attractor.py <workflow.dot> [goal]")
        sys.exit(1)

    workflow_file = Path(sys.argv[1])
    goal_override = sys.argv[2] if len(sys.argv) > 2 else None

    if not workflow_file.exists():
        print(f"Error: Workflow file not found: {workflow_file}")
        sys.exit(1)

    # Parse workflow
    parser = DOTParser()
    dot_content = workflow_file.read_text()
    pipeline = parser.parse(dot_content)

    if goal_override:
        pipeline.goal = goal_override

    print(f"\n{'='*60}")
    print(f"ATTRACTOR PIPELINE")
    print(f"{'='*60}")
    print(f"Goal: {pipeline.goal}")
    print(f"Nodes: {len(pipeline.nodes)}")
    print(f"Edges: {len(pipeline.edges)}")
    print(f"{'='*60}\n")

    # Execute pipeline
    executor = PipelineExecutor(Path.home() / ".claude" / "attractor" / "checkpoints")

    max_iterations = 100
    iteration = 0

    while iteration < max_iterations:
        ready_nodes = executor.get_ready_nodes(pipeline)

        if not ready_nodes:
            # Check if we're done
            all_complete = all(node.completed for node in pipeline.nodes.values())
            if all_complete:
                print("\n✅ Pipeline completed successfully!")
                break
            else:
                print("\n⚠️  No nodes ready but pipeline not complete - possible deadlock")
                break

        # Execute ready nodes
        for node in ready_nodes:
            success = executor.execute_node(node, pipeline)
            if success:
                node.completed = True
                pipeline.context[f"{node.id}_result"] = "success"

        # Save checkpoint
        executor.save_checkpoint(pipeline, f"checkpoint_{iteration}")

        iteration += 1

    if iteration >= max_iterations:
        print(f"\n⚠️  Max iterations ({max_iterations}) reached")


if __name__ == "__main__":
    main()
