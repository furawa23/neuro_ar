using System;
using System.Collections.Generic;
using System.Globalization;
using NeuroAR.Core;
using UnityEngine;
using UnityEngine.EventSystems;

namespace NeuroAR.Visualization
{
    /// <summary>
    /// A reusable, metre-scale 2-4-1 diagram. Rendering is independent of the
    /// camera/AR origin so the same content can be inspected on a desk or in AR.
    /// </summary>
    public sealed class NetworkView : MonoBehaviour
    {
        private sealed class NodeVisual
        {
            public int Layer;
            public int Index;
            public Transform Transform;
            public Renderer Renderer;
            public TextMesh Label;
            public Color Color;
            public double Activation;
        }

        private sealed class EdgeVisual
        {
            public int Layer;
            public int Target;
            public int Source;
            public LineRenderer Line;
            public CapsuleCollider Collider;
            public double Weight;
            public float Width;
        }

        private static readonly Color InputColor = new Color(0.21f, 0.82f, 0.94f);
        private static readonly Color HiddenColor = new Color(0.72f, 0.48f, 1f);
        private static readonly Color OutputColor = new Color(0.72f, 0.96f, 0.38f);
        private static readonly Color PositiveColor = new Color(0.32f, 0.76f, 0.78f);
        private static readonly Color NegativeColor = new Color(1f, 0.60f, 0.32f);
        private static readonly Color LabelColor = new Color(0.94f, 0.97f, 1f);
        private const float NodeDiameter = 0.048f;
        private const float PulseDuration = 1.6f;

        private readonly List<NodeVisual> nodes = new List<NodeVisual>(7);
        private readonly List<EdgeVisual> edges = new List<EdgeVisual>(12);
        private readonly List<Material> ownedMaterials = new List<Material>();
        private readonly RaycastHit[] hitBuffer = new RaycastHit[64];
        private readonly MaterialPropertyBlock propertyBlock = new MaterialPropertyBlock();
        private Camera viewCamera;
        private Material nodeMaterial;
        private Material lineMaterial;
        private Material negativeLineMaterial;
        private Texture2D dashTexture;
        private bool initialized;
        private bool labelsVisible = true;
        private bool pulseActive;
        private float pulseStarted;
        private int selectedLayer = -1;
        private int selectedTarget = -1;
        private int selectedSource = -1;
        private bool selectedIsEdge;
        private Vector2 pointerStart;
        private int activeFinger = -1;
        private bool pointerOverUi;
        private bool mousePressed;

        public event Action<int, int> NeuronSelected;
        public event Action<int, int, int> ConnectionSelected;

        /// <summary>Disable until AR content is placed; UI touches never select diagram objects.</summary>
        public bool InteractionEnabled { get; set; } = true;

        public void Initialize(Camera camera)
        {
            viewCamera = camera;
            if (initialized) return;
            initialized = true;
            nodeMaterial = CreateMaterial("Unlit/Color", "NeuroAR nodes");
            lineMaterial = CreateMaterial("Sprites/Default", "NeuroAR connections");
            negativeLineMaterial = CreateMaterial("Sprites/Default", "NeuroAR negative connections");
            dashTexture = new Texture2D(16, 1, TextureFormat.RGBA32, false)
            {
                name = "NeuroAR weight sign dashes",
                filterMode = FilterMode.Point,
                wrapMode = TextureWrapMode.Repeat
            };
            Color[] dashPixels = new Color[16];
            for (int i = 0; i < dashPixels.Length; i++)
                dashPixels[i] = i < 10 ? Color.white : new Color(1f, 1f, 1f, 0f);
            dashTexture.SetPixels(dashPixels);
            dashTexture.Apply(false, true);
            negativeLineMaterial.mainTexture = dashTexture;

            Font font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");

            CreateNode(0, 0, new Vector3(-0.30f, 0.12f, 0f), InputColor, font);
            CreateNode(0, 1, new Vector3(-0.30f, 0.32f, 0f), InputColor, font);
            // Stagger the two depth rows so labels remain separated from a front view.
            CreateNode(1, 0, new Vector3(0f, 0.105f, -0.095f), HiddenColor, font);
            CreateNode(1, 1, new Vector3(0f, 0.285f, -0.095f), HiddenColor, font);
            CreateNode(1, 2, new Vector3(0f, 0.175f, 0.095f), HiddenColor, font);
            CreateNode(1, 3, new Vector3(0f, 0.355f, 0.095f), HiddenColor, font);
            CreateNode(2, 0, new Vector3(0.30f, 0.23f, 0f), OutputColor, font);

            for (int target = 0; target < TinyNetwork.HiddenCount; target++)
                for (int source = 0; source < TinyNetwork.InputCount; source++)
                    CreateEdge(1, target, source);
            for (int source = 0; source < TinyNetwork.HiddenCount; source++)
                CreateEdge(2, 0, source);

            RefreshAppearance();
        }

        public void SetCamera(Camera camera)
        {
            viewCamera = camera;
        }

        public void Render(TinyNetwork network, NetworkSnapshot snapshot)
        {
            if (network == null) throw new ArgumentNullException(nameof(network));
            if (snapshot == null) throw new ArgumentNullException(nameof(snapshot));
            if (!initialized) Initialize(viewCamera);

            foreach (NodeVisual node in nodes)
            {
                node.Activation = node.Layer == 0 ? snapshot.Inputs[node.Index]
                    : node.Layer == 1 ? snapshot.HiddenActivations[node.Index] : snapshot.Output;
                string name = node.Layer == 0 ? "x" + (node.Index + 1)
                    : node.Layer == 1 ? "h" + (node.Index + 1) : "y";
                node.Label.text = name + "  " + node.Activation.ToString("0.00", CultureInfo.InvariantCulture);
            }

            foreach (EdgeVisual edge in edges)
            {
                edge.Weight = network.GetWeight(edge.Layer, edge.Target, edge.Source);
                edge.Line.sharedMaterial = edge.Weight < 0d ? negativeLineMaterial : lineMaterial;
                edge.Width = 0.0018f + Mathf.Min(5f, (float)Math.Abs(edge.Weight)) * 0.00125f;
            }
            RefreshAppearance();
        }

        public void SelectNeuron(int layer, int index)
        {
            if (FindNode(layer, index) == null) throw new ArgumentOutOfRangeException(nameof(index));
            selectedLayer = layer;
            selectedTarget = index;
            selectedSource = -1;
            selectedIsEdge = false;
            RefreshAppearance();
        }

        public void SelectConnection(int layer, int target, int source)
        {
            bool found = false;
            foreach (EdgeVisual edge in edges)
                if (edge.Layer == layer && edge.Target == target && edge.Source == source) found = true;
            if (!found) throw new ArgumentOutOfRangeException(nameof(target));
            selectedLayer = layer;
            selectedTarget = target;
            selectedSource = source;
            selectedIsEdge = true;
            RefreshAppearance();
        }

        public void SetLabelsVisible(bool visible)
        {
            labelsVisible = visible;
            foreach (NodeVisual node in nodes) node.Label.gameObject.SetActive(visible);
        }

        /// <summary>Plays once; this is a teaching animation, not biological firing.</summary>
        public void Pulse()
        {
            pulseStarted = Time.unscaledTime;
            pulseActive = true;
            RefreshAppearance();
        }

        private void Update()
        {
            if (pulseActive)
            {
                if (Time.unscaledTime - pulseStarted >= PulseDuration) pulseActive = false;
                RefreshAppearance();
            }
            if (InteractionEnabled && viewCamera != null) HandlePointer();
        }

        private void LateUpdate()
        {
            if (!labelsVisible || viewCamera == null) return;
            Quaternion rotation = viewCamera.transform.rotation;
            foreach (NodeVisual node in nodes) node.Label.transform.rotation = rotation;
        }

        private void HandlePointer()
        {
            if (Input.touchCount > 0)
            {
                // A two-finger gesture is never interpreted as a selection.
                if (Input.touchCount != 1) { activeFinger = -1; return; }
                Touch touch = Input.GetTouch(0);
                if (touch.phase == TouchPhase.Began)
                {
                    activeFinger = touch.fingerId;
                    pointerStart = touch.position;
                    pointerOverUi = EventSystem.current != null && EventSystem.current.IsPointerOverGameObject(touch.fingerId);
                }
                else if (touch.phase == TouchPhase.Ended && activeFinger == touch.fingerId)
                {
                    if (!pointerOverUi && (touch.position - pointerStart).sqrMagnitude < 225f)
                        Pick(touch.position);
                    activeFinger = -1;
                }
                else if (touch.phase == TouchPhase.Canceled) activeFinger = -1;
                return;
            }

            if (Input.GetMouseButtonDown(0))
            {
                mousePressed = true;
                pointerStart = Input.mousePosition;
                pointerOverUi = EventSystem.current != null && EventSystem.current.IsPointerOverGameObject();
            }
            if (Input.GetMouseButtonUp(0))
            {
                if (mousePressed && !pointerOverUi && ((Vector2)Input.mousePosition - pointerStart).sqrMagnitude < 225f)
                    Pick(Input.mousePosition);
                mousePressed = false;
            }
        }

        private void Pick(Vector2 screenPosition)
        {
            Ray ray = viewCamera.ScreenPointToRay(screenPosition);
            int count = Physics.RaycastNonAlloc(ray, hitBuffer, 15f, ~0, QueryTriggerInteraction.Collide);
            NetworkPickTarget nearestNode = null;
            NetworkPickTarget nearestEdge = null;
            float nodeDistance = float.MaxValue;
            float edgeDistance = float.MaxValue;
            for (int i = 0; i < count; i++)
            {
                NetworkPickTarget target = hitBuffer[i].collider.GetComponent<NetworkPickTarget>();
                if (target == null || target.Owner != this) continue;
                if (target.IsConnection && hitBuffer[i].distance < edgeDistance)
                {
                    nearestEdge = target;
                    edgeDistance = hitBuffer[i].distance;
                }
                else if (!target.IsConnection && hitBuffer[i].distance < nodeDistance)
                {
                    nearestNode = target;
                    nodeDistance = hitBuffer[i].distance;
                }
            }

            // Connections meet the sphere centres: favour the sphere at those junctions.
            if (nearestNode != null && nodeDistance <= edgeDistance + 0.035f)
            {
                SelectNeuron(nearestNode.Layer, nearestNode.Target);
                NeuronSelected?.Invoke(nearestNode.Layer, nearestNode.Target);
            }
            else if (nearestEdge != null)
            {
                SelectConnection(nearestEdge.Layer, nearestEdge.Target, nearestEdge.Source);
                ConnectionSelected?.Invoke(nearestEdge.Layer, nearestEdge.Target, nearestEdge.Source);
            }
        }

        private void CreateNode(int layer, int index, Vector3 position, Color color, Font font)
        {
            GameObject sphere = GameObject.CreatePrimitive(PrimitiveType.Sphere);
            sphere.name = "Neuron " + layer + ":" + index;
            sphere.transform.SetParent(transform, false);
            sphere.transform.localPosition = position;
            sphere.transform.localScale = Vector3.one * NodeDiameter;
            // Explicit component references prevent IL2CPP stripping of runtime primitives.
            sphere.GetComponent<MeshFilter>();
            sphere.GetComponent<SphereCollider>().isTrigger = true;
            MeshRenderer renderer = sphere.GetComponent<MeshRenderer>();
            renderer.sharedMaterial = nodeMaterial;
            NetworkPickTarget pick = sphere.AddComponent<NetworkPickTarget>();
            pick.Owner = this;
            pick.Layer = layer;
            pick.Target = index;

            GameObject labelObject = new GameObject("Activation label");
            labelObject.transform.SetParent(transform, false);
            labelObject.transform.localPosition = position + Vector3.up * 0.046f;
            TextMesh label = labelObject.AddComponent<TextMesh>();
            label.font = font;
            label.fontSize = 64;
            label.characterSize = 0.018f;
            label.anchor = TextAnchor.MiddleCenter;
            label.alignment = TextAlignment.Center;
            label.color = LabelColor;
            label.text = "0.00";
            // Share the font's material so dynamic glyph-atlas updates remain visible.
            if (font != null) label.GetComponent<Renderer>().sharedMaterial = font.material;
            labelObject.SetActive(labelsVisible);

            nodes.Add(new NodeVisual
            {
                Layer = layer, Index = index, Transform = sphere.transform,
                Renderer = renderer, Label = label, Color = color
            });
        }

        private void CreateEdge(int layer, int target, int source)
        {
            Vector3 start = FindNode(layer - 1, source).Transform.localPosition;
            Vector3 end = FindNode(layer, target).Transform.localPosition;
            GameObject edgeObject = new GameObject("Weight " + layer + ":" + target + ":" + source);
            edgeObject.transform.SetParent(transform, false);
            LineRenderer line = edgeObject.AddComponent<LineRenderer>();
            line.useWorldSpace = false;
            line.positionCount = 2;
            line.SetPosition(0, start);
            line.SetPosition(1, end);
            line.sharedMaterial = lineMaterial;
            line.textureMode = LineTextureMode.Tile;
            line.textureScale = new Vector2(32f, 1f);
            line.numCapVertices = 2;
            line.startWidth = line.endWidth = 0.002f;

            GameObject hitObject = new GameObject("Connection touch target");
            hitObject.transform.SetParent(transform, false);
            hitObject.transform.localPosition = (start + end) * 0.5f;
            hitObject.transform.localRotation = Quaternion.FromToRotation(Vector3.up, end - start);
            CapsuleCollider collider = hitObject.AddComponent<CapsuleCollider>();
            collider.direction = 1;
            collider.radius = 0.009f;
            collider.height = Vector3.Distance(start, end);
            collider.isTrigger = true;
            NetworkPickTarget pick = hitObject.AddComponent<NetworkPickTarget>();
            pick.Owner = this;
            pick.IsConnection = true;
            pick.Layer = layer;
            pick.Target = target;
            pick.Source = source;
            edges.Add(new EdgeVisual { Layer = layer, Target = target, Source = source, Line = line, Collider = collider, Width = 0.002f });
        }

        private NodeVisual FindNode(int layer, int index)
        {
            foreach (NodeVisual node in nodes)
                if (node.Layer == layer && node.Index == index) return node;
            return null;
        }

        private bool IsRelated(EdgeVisual edge)
        {
            if (selectedLayer < 0) return true;
            if (selectedIsEdge)
                return edge.Layer == selectedLayer && edge.Target == selectedTarget && edge.Source == selectedSource;
            return (edge.Layer == selectedLayer && edge.Target == selectedTarget)
                || (edge.Layer == selectedLayer + 1 && edge.Source == selectedTarget);
        }

        private void RefreshAppearance()
        {
            float progress = pulseActive ? Mathf.Clamp01((Time.unscaledTime - pulseStarted) / PulseDuration) : -1f;
            foreach (NodeVisual node in nodes)
            {
                bool selected = !selectedIsEdge
                    ? selectedLayer == node.Layer && selectedTarget == node.Index
                    : (selectedLayer == node.Layer && selectedTarget == node.Index)
                        || (selectedLayer - 1 == node.Layer && selectedSource == node.Index);
                float pulse = progress < 0f ? 0f : Mathf.Max(0f, 1f - Mathf.Abs(progress - node.Layer * 0.38f) / 0.16f);
                float intensity = 0.42f + Mathf.Clamp01((float)Math.Abs(node.Activation)) * 0.48f;
                Color color = Color.Lerp(node.Color * intensity, Color.white, selected ? 0.32f : pulse * 0.65f);
                color.a = 1f;
                propertyBlock.Clear();
                propertyBlock.SetColor("_Color", color);
                propertyBlock.SetColor("_BaseColor", color);
                node.Renderer.SetPropertyBlock(propertyBlock);
                node.Transform.localScale = Vector3.one * NodeDiameter * (selected ? 1.22f : 1f + pulse * 0.16f);
            }

            foreach (EdgeVisual edge in edges)
            {
                bool related = IsRelated(edge);
                bool selected = selectedIsEdge && related;
                Color color = edge.Weight < 0d ? NegativeColor : PositiveColor;
                if (!related) color = Color.Lerp(color, new Color(0.28f, 0.32f, 0.38f), 0.78f);
                float passage = progress < 0f ? 0f : Mathf.Max(0f, 1f - Mathf.Abs(progress - (edge.Layer == 1 ? 0.19f : 0.57f)) / 0.16f);
                color = Color.Lerp(color, Color.white, passage * 0.82f + (selected ? 0.15f : 0f));
                color.a = related ? 0.82f : 0.25f;
                edge.Line.startColor = edge.Line.endColor = color;
                edge.Line.startWidth = edge.Line.endWidth = edge.Width * (selected ? 1.65f : 1f + passage * 0.7f);
            }
        }

        private Material CreateMaterial(string preferredShader, string materialName)
        {
            Shader shader = Shader.Find(preferredShader) ?? Shader.Find("Unlit/Color") ?? Shader.Find("Sprites/Default");
            if (shader == null) throw new InvalidOperationException("No se encontró un shader compatible para la red neuronal.");
            Material material = new Material(shader) { name = materialName };
            ownedMaterials.Add(material);
            return material;
        }

        private void OnDisable()
        {
            activeFinger = -1;
            mousePressed = false;
            pulseActive = false;
            RefreshAppearance();
        }

        private void OnDestroy()
        {
            foreach (Material material in ownedMaterials)
                if (material != null) Destroy(material);
            if (dashTexture != null) Destroy(dashTexture);
        }
    }
}
