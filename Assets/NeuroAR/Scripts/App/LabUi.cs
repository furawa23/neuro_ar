using System;
using System.Collections.Generic;
using System.Globalization;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;

namespace NeuroAR.App
{
    /// <summary>Portrait touch UI, generated in code so the project has no prefab/font dependencies.</summary>
    public sealed class LabUi : MonoBehaviour
    {
        public event Action ModeRequested;
        public event Action RepositionRequested;
        public event Action<int> SampleRequested;
        public event Action PlayRequested;
        public event Action StepRequested;
        public event Action ResetRequested;
        public event Action PulseRequested;
        public event Action<float> ParameterChanged;
        public event Action<int> HistoryChanged;

        private static readonly Color Ink = new Color(0.035f, 0.052f, 0.085f, 0.97f);
        private static readonly Color Surface = new Color(0.08f, 0.105f, 0.155f, 1);
        private static readonly Color Foreground = new Color(0.92f, 0.95f, 1, 1);
        private static readonly Color Muted = new Color(0.63f, 0.7f, 0.8f, 1);
        private static readonly Color Cyan = new Color(0.24f, 0.87f, 0.88f, 1);
        private static readonly Color Purple = new Color(0.73f, 0.62f, 1, 1);
        private Font font;
        private RectTransform safeRoot;
        private RectTransform previewArea;
        private readonly Vector3[] previewCorners = new Vector3[4];
        private Rect previousSafeArea;
        private Vector2 previousScreen;
        private Text modeLabel;
        private Text playLabel;
        private Text statusText;
        private Text sampleText;
        private Text inspectorCategory;
        private Text inspectorTitle;
        private Text inspectorMath;
        private Text inspectorLesson;
        private Text parameterLabel;
        private Text parameterValue;
        private Text trainingText;
        private Text historyText;
        private Slider parameter;
        private Slider timeline;
        private Button reposition;
        private readonly List<Button> samples = new List<Button>();
        private LossGraphic lossGraph;
        private string spatialStatus;
        private bool spatialMode;
        private bool spatialPlaced;
        private bool updating;
        private string parameterIdentity;

        public Rect PreviewViewport
        {
            get
            {
                if (previewArea == null || Screen.width == 0 || Screen.height == 0) return new Rect(0.04f, 0.54f, 0.92f, 0.18f);
                previewArea.GetWorldCorners(previewCorners);
                return Rect.MinMaxRect(
                    Mathf.Clamp01(previewCorners[0].x / Screen.width),
                    Mathf.Clamp01(previewCorners[0].y / Screen.height),
                    Mathf.Clamp01(previewCorners[2].x / Screen.width),
                    Mathf.Clamp01(previewCorners[2].y / Screen.height));
            }
        }

        public void Initialize()
        {
            font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
            var canvasObject = new GameObject("NeuroAR Interface", typeof(RectTransform), typeof(Canvas), typeof(CanvasScaler), typeof(GraphicRaycaster));
            canvasObject.transform.SetParent(transform, false);
            var canvas = canvasObject.GetComponent<Canvas>();
            canvas.renderMode = RenderMode.ScreenSpaceOverlay;
            canvas.sortingOrder = 20;
            var scaler = canvasObject.GetComponent<CanvasScaler>();
            scaler.uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
            scaler.referenceResolution = new Vector2(720, 1280);
            scaler.screenMatchMode = CanvasScaler.ScreenMatchMode.MatchWidthOrHeight;
            scaler.matchWidthOrHeight = 0.5f;
            safeRoot = CreateRect("Safe Area", canvasObject.transform);
            if (FindFirstObjectByType<EventSystem>() == null)
                new GameObject("Event System", typeof(EventSystem), typeof(StandaloneInputModule));

            var header = Box("Header", safeRoot, Ink);
            Top(header.rectTransform, 0, 0, 0, 108);
            TextAt("Brand", safeRoot, "NEURO", 36, Foreground, 24, 490, 12, 50, FontStyle.Bold);
            TextAt("AR", safeRoot, "AR", 36, Cyan, 161, 440, 12, 50, FontStyle.Bold);
            TextAt("Subtitle", safeRoot, "LABORATORIO", 18, Muted, 26, 490, 67, 25);
            var mode = ActionButton("Mode", safeRoot, "Ver marcador", Cyan, () => ModeRequested?.Invoke());
            TopSplit(mode.GetComponent<RectTransform>(), 0.65f, 1, 6, 24, 12, 88);
            modeLabel = mode.GetComponentInChildren<Text>();
            var pulse = ActionButton("Signal", safeRoot, "Ver señal", Surface, () => PulseRequested?.Invoke());
            TopSplit(pulse.GetComponent<RectTransform>(), 0.33f, 0.65f, 6, 6, 12, 88);

            string[] names = { "0, 0 → 0", "0, 1 → 1", "1, 0 → 1", "1, 1 → 0" };
            for (int i = 0; i < names.Length; i++)
            {
                int index = i;
                var button = ActionButton("Example " + i, safeRoot, names[i], Surface, () => SampleRequested?.Invoke(index));
                TopSplit(button.GetComponent<RectTransform>(), i * 0.25f, (i + 1) * 0.25f,
                    i == 0 ? 24 : 6, i == 3 ? 24 : 6, 116, 88);
                samples.Add(button);
            }
            statusText = TextAt("Tracking status", safeRoot, "Preparando laboratorio…", 22, Muted, 24, 170, 220, 62);
            reposition = ActionButton("Reposition", safeRoot, "Reescanear", Surface, () => RepositionRequested?.Invoke());
            TopSplit(reposition.GetComponent<RectTransform>(), 0.77f, 1, 4, 24, 216, 88);
            reposition.gameObject.SetActive(false);
            sampleText = TextAt("Prediction", safeRoot, "", 23, Foreground, 24, 24, 298, 60);
            previewArea = CreateRect("Visible network area", safeRoot);
            previewArea.offsetMin = new Vector2(24, 688);
            previewArea.offsetMax = new Vector2(-24, -360);

            var bottom = Box("Inspector and Training", safeRoot, Ink);
            var panel = bottom.rectTransform;
            panel.anchorMin = Vector2.zero;
            panel.anchorMax = new Vector2(1, 0);
            panel.pivot = Vector2.zero;
            panel.offsetMin = Vector2.zero;
            panel.offsetMax = new Vector2(0, 676);
            var hairline = Box("Divider", panel, new Color(Cyan.r, Cyan.g, Cyan.b, 0.45f));
            Top(hairline.rectTransform, 24, 24, 0, 2);
            inspectorCategory = TextAt("Category", panel, "", 20, Purple, 24, 24, 16, 28);
            inspectorTitle = TextAt("Selected value", panel, "", 32, Foreground, 24, 24, 50, 44, FontStyle.Bold);
            inspectorMath = TextAt("Calculation", panel, "", 26, Foreground, 24, 24, 104, 68);
            inspectorLesson = TextAt("Explanation", panel, "", 22, Muted, 24, 24, 182, 56);
            parameterLabel = TextAt("Parameter", panel, "Modificar sesgo", 24, Foreground, 24, 170, 248, 32);
            parameterValue = TextAt("Parameter value", panel, "", 24, Cyan, 0, 24, 248, 32);
            parameterValue.alignment = TextAnchor.MiddleRight;
            parameter = CreateSlider("Edit parameter", panel, -4, 4, value => ParameterChanged?.Invoke(value));
            Top(parameter.GetComponent<RectTransform>(), 30, 30, 286, 88);
            trainingText = TextAt("Training metrics", panel, "", 25, Foreground, 24, 24, 382, 36);
            var plotRoot = CreateRect("Recorded loss", panel);
            Top(plotRoot, 26, 26, 430, 34);
            lossGraph = plotRoot.gameObject.AddComponent<LossGraphic>();
            lossGraph.color = Cyan;
            lossGraph.raycastTarget = false;
            historyText = TextAt("History label", panel, "", 20, Muted, 24, 24, 474, 28);
            timeline = CreateSlider("Training history", panel, 0, 1, value => HistoryChanged?.Invoke(Mathf.RoundToInt(value)));
            timeline.wholeNumbers = true;
            Top(timeline.GetComponent<RectTransform>(), 30, 30, 504, 64);
            var play = ActionButton("Train", panel, "Entrenar", Cyan, () => PlayRequested?.Invoke());
            TopSplit(play.GetComponent<RectTransform>(), 0, 0.42f, 24, 6, 576, 88);
            playLabel = play.GetComponentInChildren<Text>();
            var step = ActionButton("Step", panel, "+10 épocas", Surface, () => StepRequested?.Invoke());
            TopSplit(step.GetComponent<RectTransform>(), 0.42f, 0.73f, 6, 6, 576, 88);
            var reset = ActionButton("Reset", panel, "Reiniciar", Surface, () => ResetRequested?.Invoke());
            TopSplit(reset.GetComponent<RectTransform>(), 0.73f, 1, 6, 24, 576, 88);
            ApplySafeArea();
            Canvas.ForceUpdateCanvases();
        }

        private void Update()
        {
            if (safeRoot != null && (Screen.safeArea != previousSafeArea || previousScreen != new Vector2(Screen.width, Screen.height))) ApplySafeArea();
        }

        private void ApplySafeArea()
        {
            previousSafeArea = Screen.safeArea;
            previousScreen = new Vector2(Screen.width, Screen.height);
            if (Screen.width == 0 || Screen.height == 0) return;
            safeRoot.anchorMin = new Vector2(previousSafeArea.xMin / Screen.width, previousSafeArea.yMin / Screen.height);
            safeRoot.anchorMax = new Vector2(previousSafeArea.xMax / Screen.width, previousSafeArea.yMax / Screen.height);
            safeRoot.offsetMin = safeRoot.offsetMax = Vector2.zero;
        }

        public void SetSpatialState(bool arMode, bool placed, string status)
        {
            if (spatialStatus == status && spatialMode == arMode && spatialPlaced == placed) return;
            spatialStatus = status;
            spatialMode = arMode;
            spatialPlaced = placed;
            statusText.text = status;
            modeLabel.text = arMode ? "Volver a 3D" : "Ver marcador";
            reposition.gameObject.SetActive(arMode);
        }

        public void SetPlaying(bool playing) { playLabel.text = playing ? "Pausar" : "Entrenar"; }

        public void SetSample(int index, float output, int target)
        {
            for (int i = 0; i < samples.Count; i++)
            {
                samples[i].GetComponent<Image>().color = i == index ? Cyan : Surface;
                samples[i].GetComponentInChildren<Text>().color = i == index ? Ink : Foreground;
            }
            sampleText.text = "XOR · entradas distintas → 1\nEsperado " + target + "    ·    Salida " + output.ToString("0.000", CultureInfo.InvariantCulture)
                + "    ·    Clase " + (output >= 0.5f ? "1" : "0");
        }

        public void SetInspector(string category, string title, string math, string lesson, string editableLabel, float value, bool editable)
        {
            inspectorCategory.text = category;
            inspectorTitle.text = title;
            inspectorMath.text = math;
            inspectorLesson.text = lesson;
            parameterLabel.text = editableLabel;
            parameterValue.text = editable ? value.ToString("0.000", CultureInfo.InvariantCulture) : "";
            updating = true;
            try
            {
                if (parameterIdentity != category || value < parameter.minValue || value > parameter.maxValue)
                {
                    parameterIdentity = category;
                    float extent = Mathf.Max(4, Mathf.Ceil(Mathf.Abs(value)) + 1);
                    parameter.minValue = -extent;
                    parameter.maxValue = extent;
                }
                parameter.SetValueWithoutNotify(value);
                parameter.interactable = editable;
            }
            finally { updating = false; }
        }

        public void SetTraining(int epoch, float loss, int index, int maximumIndex, IReadOnlyList<float> losses)
        {
            trainingText.text = "Época " + epoch + "    ·    Error BCE " + loss.ToString("0.0000", CultureInfo.InvariantCulture);
            historyText.text = maximumIndex == 0 ? "Entrena para crear el historial" : "Historial · estado " + (index + 1) + " de " + (maximumIndex + 1);
            updating = true;
            try
            {
                timeline.maxValue = Mathf.Max(1, maximumIndex);
                timeline.SetValueWithoutNotify(index);
                timeline.interactable = maximumIndex > 0;
            }
            finally { updating = false; }
            lossGraph.SetValues(losses, index);
        }

        private RectTransform CreateRect(string objectName, Transform parent)
        {
            var go = new GameObject(objectName, typeof(RectTransform));
            var rect = go.GetComponent<RectTransform>();
            rect.SetParent(parent, false);
            rect.anchorMin = Vector2.zero;
            rect.anchorMax = Vector2.one;
            rect.offsetMin = rect.offsetMax = Vector2.zero;
            return rect;
        }

        private Image Box(string objectName, Transform parent, Color color)
        {
            var image = CreateRect(objectName, parent).gameObject.AddComponent<Image>();
            image.color = color;
            return image;
        }

        private Text TextAt(string objectName, Transform parent, string content, int size, Color color, float left, float right, float top, float height, FontStyle style = FontStyle.Normal)
        {
            var rect = CreateRect(objectName, parent);
            Top(rect, left, right, top, height);
            var text = rect.gameObject.AddComponent<Text>();
            text.font = font;
            text.fontSize = size;
            text.fontStyle = style;
            text.color = color;
            text.text = content;
            text.alignment = TextAnchor.MiddleLeft;
            text.horizontalOverflow = HorizontalWrapMode.Wrap;
            text.verticalOverflow = VerticalWrapMode.Truncate;
            text.raycastTarget = false;
            return text;
        }

        private Button ActionButton(string objectName, Transform parent, string label, Color color, Action callback)
        {
            var image = Box(objectName, parent, color);
            var button = image.gameObject.AddComponent<Button>();
            button.targetGraphic = image;
            var palette = button.colors;
            palette.highlightedColor = new Color(0.88f, 0.94f, 1, 1);
            palette.pressedColor = new Color(0.65f, 0.75f, 0.84f, 1);
            palette.disabledColor = new Color(0.45f, 0.5f, 0.6f, 0.65f);
            button.colors = palette;
            var text = TextAt("Label", image.transform, label, 25, color == Cyan ? Ink : Foreground, 6, 6, 0, 88, FontStyle.Bold);
            text.alignment = TextAnchor.MiddleCenter;
            var navigation = button.navigation;
            navigation.mode = Navigation.Mode.None;
            button.navigation = navigation;
            button.onClick.AddListener(() => callback());
            return button;
        }

        private Slider CreateSlider(string objectName, Transform parent, float minimum, float maximum, Action<float> changed)
        {
            var root = CreateRect(objectName, parent);
            var hit = root.gameObject.AddComponent<Image>();
            hit.color = Color.clear;
            var slider = root.gameObject.AddComponent<Slider>();
            var track = Box("Track", root, Surface);
            track.rectTransform.anchorMin = new Vector2(0, 0.4f);
            track.rectTransform.anchorMax = new Vector2(1, 0.6f);
            var fillArea = CreateRect("Fill Area", root);
            fillArea.anchorMin = new Vector2(0, 0.4f);
            fillArea.anchorMax = new Vector2(1, 0.6f);
            var fill = Box("Fill", fillArea, Cyan);
            var handleArea = CreateRect("Handle Area", root);
            handleArea.anchorMin = new Vector2(0, 0.5f);
            handleArea.anchorMax = new Vector2(1, 0.5f);
            handleArea.offsetMin = new Vector2(16, -19);
            handleArea.offsetMax = new Vector2(-16, 19);
            var handle = Box("Handle", handleArea, Foreground);
            handle.rectTransform.anchorMin = Vector2.zero;
            handle.rectTransform.anchorMax = new Vector2(0, 1);
            handle.rectTransform.sizeDelta = new Vector2(32, 0);
            slider.fillRect = fill.rectTransform;
            slider.handleRect = handle.rectTransform;
            slider.targetGraphic = handle;
            slider.minValue = minimum;
            slider.maxValue = maximum;
            var navigation = slider.navigation;
            navigation.mode = Navigation.Mode.None;
            slider.navigation = navigation;
            slider.onValueChanged.AddListener(value => { if (!updating) changed(value); });
            return slider;
        }

        private static void Top(RectTransform rect, float left, float right, float top, float height)
        {
            rect.anchorMin = new Vector2(0, 1);
            rect.anchorMax = Vector2.one;
            rect.pivot = new Vector2(0.5f, 1);
            rect.offsetMin = new Vector2(left, -top - height);
            rect.offsetMax = new Vector2(-right, -top);
        }

        private static void TopSplit(RectTransform rect, float minimum, float maximum, float left, float right, float top, float height)
        {
            Top(rect, left, right, top, height);
            rect.anchorMin = new Vector2(minimum, 1);
            rect.anchorMax = new Vector2(maximum, 1);
        }
    }
}
