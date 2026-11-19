using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;

namespace NeuroAR.App
{
    /// <summary>Small loss plot drawn from recorded model states, without per-frame allocations.</summary>
    public sealed class LossGraphic : Graphic
    {
        private readonly List<float> points = new List<float>();
        private int selected;

        public void SetValues(IReadOnlyList<float> values, int selectedIndex)
        {
            points.Clear();
            for (int i = 0; i < values.Count; i++) points.Add(values[i]);
            selected = Mathf.Clamp(selectedIndex, 0, Mathf.Max(0, points.Count - 1));
            SetVerticesDirty();
        }

        protected override void OnPopulateMesh(VertexHelper vh)
        {
            vh.Clear();
            if (points.Count < 2) return;
            Rect bounds = rectTransform.rect;
            float maximum = 0.8f;
            for (int i = 0; i < points.Count; i++) maximum = Mathf.Max(maximum, points[i]);
            for (int i = 1; i < points.Count; i++)
            {
                Vector2 a = new Vector2(bounds.xMin + bounds.width * (i - 1) / (points.Count - 1), bounds.yMin + 4 + (bounds.height - 8) * points[i - 1] / maximum);
                Vector2 b = new Vector2(bounds.xMin + bounds.width * i / (points.Count - 1), bounds.yMin + 4 + (bounds.height - 8) * points[i] / maximum);
                Vector2 normal = new Vector2(-(b - a).y, (b - a).x).normalized * 1.5f;
                Color tint = i <= selected ? color : new Color(color.r, color.g, color.b, 0.2f);
                int vertex = vh.currentVertCount;
                vh.AddVert(a - normal, tint, Vector2.zero);
                vh.AddVert(a + normal, tint, Vector2.zero);
                vh.AddVert(b + normal, tint, Vector2.zero);
                vh.AddVert(b - normal, tint, Vector2.zero);
                vh.AddTriangle(vertex, vertex + 1, vertex + 2);
                vh.AddTriangle(vertex, vertex + 2, vertex + 3);
            }
        }
    }
}
