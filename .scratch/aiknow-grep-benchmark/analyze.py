import json
import re
import sys
from pathlib import Path


def text_content(content):
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return ""
    return "\n".join(
        part.get("text", "")
        for part in content
        if isinstance(part, dict) and part.get("type") == "text"
    )


def analyze(path):
    entries = [json.loads(line) for line in Path(path).read_text(encoding="utf-8").splitlines() if line.strip()]
    message_entries = [e for e in entries if e.get("type") == "message"]
    user_indexes = [i for i, e in enumerate(entries) if e.get("type") == "message" and e.get("message", {}).get("role") == "user"]
    start = user_indexes[0]
    end = user_indexes[1] if len(user_indexes) > 1 else len(entries)
    turn = entries[start:end]

    assistant = [e for e in turn if e.get("type") == "message" and e.get("message", {}).get("role") == "assistant"]
    tool_results = [e for e in turn if e.get("type") == "message" and e.get("message", {}).get("role") == "toolResult"]
    usages = [e["message"]["usage"] for e in assistant if e.get("message", {}).get("usage")]
    tool_calls = []
    for e in assistant:
        for part in e.get("message", {}).get("content", []):
            if isinstance(part, dict) and part.get("type") == "toolCall":
                tool_calls.append(part)

    final_candidates = [e for e in assistant if e.get("message", {}).get("stopReason") == "stop"]
    final = text_content(final_candidates[-1]["message"].get("content", [])) if final_candidates else ""
    result_texts = [text_content(e["message"].get("content", [])) for e in tool_results]

    prompt_contexts = [u.get("input", 0) + u.get("cacheRead", 0) + u.get("cacheWrite", 0) for u in usages]
    costs = [u.get("cost", {}).get("total", 0) for u in usages]
    first_ts = turn[0].get("timestamp")
    final_ts = final_candidates[-1].get("timestamp") if final_candidates else turn[-1].get("timestamp")
    citations = re.findall(r"(?:[A-Za-z0-9_.-]+/)+[A-Za-z0-9_.-]+:\d+(?:[-–]\d+)?", final)
    tool_names = {}
    for call in tool_calls:
        tool_names[call.get("name", "unknown")] = tool_names.get(call.get("name", "unknown"), 0) + 1

    model_change = next((e for e in entries if e.get("type") == "model_change"), {})
    thinking_change = next((e for e in entries if e.get("type") == "thinking_level_change"), {})
    return {
        "session_file": str(path),
        "model": f"{model_change.get('provider')}/{model_change.get('modelId')}",
        "thinking_level": thinking_change.get("thinkingLevel"),
        "duration_seconds": round((__import__('datetime').datetime.fromisoformat(final_ts.replace('Z', '+00:00')) - __import__('datetime').datetime.fromisoformat(first_ts.replace('Z', '+00:00'))).total_seconds(), 3),
        "assistant_api_calls": len(usages),
        "tool_calls": len(tool_calls),
        "tool_calls_by_name": tool_names,
        "tool_result_chars": sum(len(x) for x in result_texts),
        "tool_result_lines": sum(x.count("\n") + (1 if x else 0) for x in result_texts),
        "tool_result_est_tokens_chars_div_4": round(sum(len(x) for x in result_texts) / 4),
        "peak_request_context_tokens": max(prompt_contexts) if prompt_contexts else 0,
        "sum_request_input_tokens": sum(prompt_contexts),
        "output_tokens": sum(u.get("output", 0) for u in usages),
        "reasoning_tokens": sum(u.get("reasoning", 0) for u in usages),
        "total_cost_usd": round(sum(costs), 6),
        "final_answer_chars": len(final),
        "final_answer_lines": final.count("\n") + (1 if final else 0),
        "citation_occurrences": len(citations),
        "unique_citations": len(set(citations)),
        "final_answer": final,
    }


if __name__ == "__main__":
    reports = [analyze(p) for p in sys.argv[1:]]
    print(json.dumps(reports, indent=2, ensure_ascii=False))
