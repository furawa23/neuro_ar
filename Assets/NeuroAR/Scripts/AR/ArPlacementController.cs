using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.EventSystems;

namespace NeuroAR.AR
{
    /// <summary>Switches between orbit exploration and camera tracking of the printed marker.</summary>
    public sealed class ArPlacementController : MonoBehaviour
    {
        public Transform Content { get; set; }
        public Camera ViewCamera => IsArMode && marker != null ? marker.ViewCamera : previewCamera;
        public bool IsPlaced => IsArMode && marker != null && marker.IsTracking;
        public bool IsArMode { get; private set; }
        public string Status => IsArMode && marker != null ? marker.Status : previewStatus;
        public event Action Placed;

        private readonly List<RaycastResult> uiHits = new List<RaycastResult>();
        private Camera previewCamera;
        private MarkerCameraTracker marker;
        private Vector3 previewScale;
        private bool initialized;
        private bool dragging;
        private bool wasTracking;
        private Vector2 lastPointer;
        private float yaw = -14f;
        private float pitch = 8f;
        private float distance = 1.15f;
        private Rect previewViewport = new Rect(0, 0, 1, 1);
        private Vector2Int previewScreen;
        private float framedDistance = 1.15f;
        private float configuredAspect;
        private float configuredFieldOfView;
        private string previewStatus = "Modo 3D · arrastra el fondo para girar y pellizca para acercarte.";

        public void Initialize(Transform content)
        {
            if (content == null) throw new ArgumentNullException(nameof(content));
            Content = content;
            if (initialized) return;
            initialized = true;
            previewScale = content.localScale;
            var cameraObject = new GameObject("Cámara de exploración 3D");
            previewCamera = cameraObject.AddComponent<Camera>();
            previewCamera.tag = "MainCamera";
            previewCamera.nearClipPlane = 0.015f;
            previewCamera.farClipPlane = 30f;
            previewCamera.fieldOfView = 48f;
            previewCamera.clearFlags = CameraClearFlags.SolidColor;
            previewCamera.backgroundColor = new Color(0.025f, 0.035f, 0.065f);
            cameraObject.AddComponent<AudioListener>();
            marker = gameObject.AddComponent<MarkerCameraTracker>();
            marker.Initialize(content);
            marker.Failed += OnMarkerFailed;
            UpdatePreviewCamera();
        }

        public void ConfigurePreviewViewport(Rect normalized)
        {
            var xMin = Mathf.Clamp01(normalized.xMin);
            var yMin = Mathf.Clamp01(normalized.yMin);
            var viewport = Rect.MinMaxRect(xMin, yMin,
                Mathf.Clamp(normalized.xMax, xMin, 1), Mathf.Clamp(normalized.yMax, yMin, 1));
            if (viewport.width < 0.05f || viewport.height < 0.05f || previewCamera == null) return;
            var screen = new Vector2Int(Screen.width, Screen.height);
            var aspect = previewCamera.aspect;
            var fieldOfView = previewCamera.fieldOfView;
            if (viewport == previewViewport && screen == previewScreen &&
                Mathf.Approximately(aspect, configuredAspect) && Mathf.Approximately(fieldOfView, configuredFieldOfView)) return;
            previewViewport = viewport;
            previewScreen = screen;
            configuredAspect = aspect;
            configuredFieldOfView = fieldOfView;
            var tangent = Mathf.Tan(fieldOfView * 0.5f * Mathf.Deg2Rad);
            var verticalFit = 0.20f / (tangent * viewport.height * 0.88f);
            var horizontalFit = 0.40f / (tangent * aspect * viewport.width * 0.88f);
            framedDistance = Mathf.Max(0.65f, Mathf.Max(verticalFit, horizontalFit) + 0.15f);
            distance = framedDistance;
            UpdatePreviewCamera();
        }

        public void SetArMode(bool enabled)
        {
            if (!initialized || Content == null || enabled == IsArMode) return;
            IsArMode = enabled;
            wasTracking = false;
            dragging = false;
            if (enabled)
            {
                previewCamera.gameObject.SetActive(false);
                Content.gameObject.SetActive(false);
                marker.StartTracking();
            }
            else
            {
                marker.StopTracking();
                Content.SetParent(null, false);
                Content.SetPositionAndRotation(Vector3.zero, Quaternion.identity);
                Content.localScale = previewScale;
                Content.gameObject.SetActive(true);
                previewCamera.gameObject.SetActive(true);
                previewStatus = "Modo 3D · arrastra el fondo para girar y pellizca para acercarte.";
                UpdatePreviewCamera();
            }
        }

        public void Reposition()
        {
            if (IsArMode) { marker.Reacquire(); return; }
            yaw = -14;
            pitch = 8;
            distance = framedDistance;
            UpdatePreviewCamera();
        }

        private void OnMarkerFailed(string reason)
        {
            SetArMode(false);
            previewStatus = reason;
        }

        private void Update()
        {
            if (!initialized || Content == null) return;
            if (IsArMode)
            {
                bool tracking = IsPlaced;
                if (tracking && !wasTracking) Placed?.Invoke();
                wasTracking = tracking;
                return;
            }
            UpdatePreviewInput();
            UpdatePreviewCamera();
        }

        private bool IsOverUi(Vector2 position)
        {
            if (EventSystem.current == null) return false;
            uiHits.Clear();
            EventSystem.current.RaycastAll(new PointerEventData(EventSystem.current) { position = position }, uiHits);
            return uiHits.Count > 0;
        }

        private bool HitsContent(Vector2 position)
        {
            return Content.gameObject.activeInHierarchy && Physics.Raycast(previewCamera.ScreenPointToRay(position), out var hit, 30)
                && hit.transform.IsChildOf(Content);
        }

        private void UpdatePreviewInput()
        {
            float maximumDistance = Mathf.Max(4, framedDistance * 1.5f);
            if (Input.touchCount == 2)
            {
                var a = Input.GetTouch(0);
                var b = Input.GetTouch(1);
                if (IsOverUi(a.position) || IsOverUi(b.position)) return;
                float previous = Vector2.Distance(a.position - a.deltaPosition, b.position - b.deltaPosition);
                float current = Vector2.Distance(a.position, b.position);
                distance = Mathf.Clamp(distance - (current - previous) * 0.004f, 0.45f, maximumDistance);
                dragging = false;
                return;
            }
            if (Input.touchCount == 1)
            {
                var touch = Input.GetTouch(0);
                if (touch.phase == TouchPhase.Began)
                {
                    dragging = !IsOverUi(touch.position) && !HitsContent(touch.position);
                    lastPointer = touch.position;
                }
                else if (dragging && touch.phase == TouchPhase.Moved)
                {
                    Orbit(touch.position - lastPointer);
                    lastPointer = touch.position;
                }
                else if (touch.phase == TouchPhase.Ended || touch.phase == TouchPhase.Canceled) dragging = false;
                return;
            }
            if (Input.GetMouseButtonDown(0))
            {
                lastPointer = Input.mousePosition;
                dragging = !IsOverUi(lastPointer) && !HitsContent(lastPointer);
            }
            if (Input.GetMouseButton(0) && dragging)
            {
                Vector2 current = Input.mousePosition;
                Orbit(current - lastPointer);
                lastPointer = current;
            }
            if (Input.GetMouseButtonUp(0)) dragging = false;
            if (!IsOverUi(Input.mousePosition))
                distance = Mathf.Clamp(distance - Input.mouseScrollDelta.y * 0.15f, 0.45f, maximumDistance);
        }

        private void Orbit(Vector2 delta)
        {
            yaw -= delta.x * 0.25f;
            pitch = Mathf.Clamp(pitch + delta.y * 0.2f, -65, 65);
        }

        private void UpdatePreviewCamera()
        {
            if (previewCamera == null || Content == null) return;
            var rotation = Quaternion.Euler(pitch, yaw, 0);
            var target = Content.TransformPoint(new Vector3(0, 0.23f, 0));
            previewCamera.transform.position = target + rotation * (Vector3.back * distance);
            previewCamera.transform.LookAt(target);
            var projection = Matrix4x4.Perspective(previewCamera.fieldOfView, previewCamera.aspect,
                previewCamera.nearClipPlane, previewCamera.farClipPlane);
            projection[0, 2] = 1 - 2 * previewViewport.center.x;
            projection[1, 2] = 1 - 2 * previewViewport.center.y;
            previewCamera.projectionMatrix = projection;
        }

        private void OnDestroy()
        {
            if (marker != null)
            {
                marker.Failed -= OnMarkerFailed;
                marker.StopTracking();
            }
            if (previewCamera != null) Destroy(previewCamera.gameObject);
        }
    }
}
