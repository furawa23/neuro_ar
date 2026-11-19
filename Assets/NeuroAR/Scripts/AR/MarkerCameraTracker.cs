using System;
using System.Collections;
using NeuroAR.Vision;
using UnityEngine;
#if UNITY_ANDROID
using UnityEngine.Android;
#endif

namespace NeuroAR.AR
{
    /// <summary>
    /// Camera-only tracking of the printed NeuroAR square. This intentionally does
    /// not preserve a world anchor after the image leaves the camera's view.
    /// Intrinsics are an initial pinhole estimate, not a device calibration.
    /// </summary>
    [DefaultExecutionOrder(-200)]
    public sealed class MarkerCameraTracker : MonoBehaviour
    {
        private const int MaximumDetectionDimension = 512;
        private const float DetectionInterval = 1f / 12f;
        private const float BackgroundDistance = 8f;
        private const float ContentScale = 0.35f;
        private const float EstimatedLongSideFov = 60f;
        private const float StalePoseSeconds = 0.2f;
        private const float FrameTimeoutSeconds = 5f;

        public Camera ViewCamera { get; private set; }
        public bool IsRunning { get; private set; }
        public bool IsTracking { get; private set; }
        public string Status { get; private set; } = "Apunta al marcador impreso de NeuroAR.";
        public event Action<string> Failed;
        public event Action TrackingFound;

        private readonly MarkerDetector detector = new MarkerDetector();
        private Transform content;
        private Vector3 originalScale;
        private GameObject cameraRoot;
        private GameObject background;
        private Mesh backgroundMesh;
        private Material backgroundMaterial;
        private WebCamTexture webcam;
        private Color32[] cameraPixels;
        private byte[] grayscale;
        private int[] sourceIndices;
        private bool initialized;
        private bool requested;
        private bool applicationPaused;
        private bool starting;
        private int generation;
        private int rawWidth;
        private int rawHeight;
        private int uprightWidth;
        private int uprightHeight;
        private int detectionWidth;
        private int detectionHeight;
        private int rotation;
        private bool mirrored;
        private int configuredScreenWidth;
        private int configuredScreenHeight;
        private CameraIntrinsics detectionIntrinsics;
        private float nextDetection;
        private float lastCameraFrame;
        private float lastObservation;
        private float lastPoseUpdate;
        private int consecutiveObservations;
        private bool hasPose;
        private Vector3 filteredPosition;
        private Quaternion filteredRotation;

        public void Initialize(Transform networkContent)
        {
            if (networkContent == null) throw new ArgumentNullException(nameof(networkContent));
            if (initialized) return;
            content = networkContent;
            originalScale = content.localScale;

            cameraRoot = new GameObject("Cámara del marcador impreso");
            cameraRoot.SetActive(false);
            cameraRoot.transform.SetParent(transform, false);
            ViewCamera = cameraRoot.AddComponent<Camera>();
            ViewCamera.tag = "MainCamera";
            ViewCamera.clearFlags = CameraClearFlags.SolidColor;
            ViewCamera.backgroundColor = new Color(0.025f, 0.035f, 0.065f);
            ViewCamera.nearClipPlane = 0.01f;
            ViewCamera.farClipPlane = 20f;
            ViewCamera.fieldOfView = EstimatedLongSideFov;
            cameraRoot.AddComponent<AudioListener>();

            background = new GameObject("Imagen de la cámara");
            background.transform.SetParent(cameraRoot.transform, false);
            var filter = background.AddComponent<MeshFilter>();
            var renderer = background.AddComponent<MeshRenderer>();
            renderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            renderer.receiveShadows = false;
            var shader = Shader.Find("Unlit/Texture");
            if (shader == null) throw new InvalidOperationException("No se encontró el shader Unlit/Texture para la cámara.");
            backgroundMaterial = new Material(shader) { name = "NeuroAR camera background" };
            renderer.sharedMaterial = backgroundMaterial;
            backgroundMesh = new Mesh { name = "NeuroAR camera image quad" };
            filter.sharedMesh = backgroundMesh;
            background.SetActive(false);
            initialized = true;
        }

        public void StartTracking()
        {
            if (!initialized) throw new InvalidOperationException("Inicializa el seguimiento antes de activar la cámara.");
            requested = true;
            if (applicationPaused || starting || IsRunning || !isActiveAndEnabled) return;
            BeginStartup();
        }

        public void StopTracking()
        {
            requested = false;
            ReleaseCapture();
            Status = "Cámara detenida · modo 3D disponible.";
        }

        public void Reacquire()
        {
            ResetPose();
            Status = IsRunning ? "Busca de nuevo el marcador completo, con su margen blanco." : "Preparando la cámara…";
        }

        private void BeginStartup()
        {
            if (!initialized || !requested || starting || IsRunning) return;
            starting = true;
            int ticket = ++generation;
            cameraRoot.SetActive(true);
            ResetPose();
            content.localScale = originalScale * ContentScale;
            Status = "Preparando cámara trasera…";
            StartCoroutine(StartCameraSafely(ticket));
        }

        private IEnumerator StartCameraSafely(int ticket)
        {
            var routine = StartCamera(ticket);
            try
            {
                while (ticket == generation && requested)
                {
                    object current = null;
                    bool moved = false;
                    Exception failure = null;
                    try
                    {
                        moved = routine.MoveNext();
                        if (moved) current = routine.Current;
                    }
                    catch (Exception exception) { failure = exception; }
                    if (failure != null)
                    {
                        Debug.LogException(failure);
                        Fail("No se pudo abrir la cámara. Vuelve a 3D e inténtalo de nuevo.");
                        yield break;
                    }
                    if (!moved) yield break;
                    yield return current;
                }
            }
            finally
            {
                (routine as IDisposable)?.Dispose();
                if (ticket == generation) starting = false;
            }
        }

        private IEnumerator StartCamera(int ticket)
        {
#if UNITY_ANDROID && !UNITY_EDITOR
            if (!Permission.HasUserAuthorizedPermission(Permission.Camera))
            {
                bool answered = false;
                var callbacks = new PermissionCallbacks();
                callbacks.PermissionGranted += _ => answered = true;
                callbacks.PermissionDenied += _ => answered = true;
                callbacks.PermissionDeniedAndDontAskAgain += _ => answered = true;
                Status = "Autoriza la cámara para seguir el marcador impreso.";
                Permission.RequestUserPermission(Permission.Camera, callbacks);
                float deadline = Time.realtimeSinceStartup + 60f;
                while (!answered && ticket == generation && requested && Time.realtimeSinceStartup < deadline) yield return null;
                if (ticket != generation || !requested) yield break;
                if (!Permission.HasUserAuthorizedPermission(Permission.Camera))
                {
                    Fail("Autoriza la cámara en Ajustes de Android para utilizar el marcador.");
                    yield break;
                }
            }
#else
            if (!Application.HasUserAuthorization(UserAuthorization.WebCam))
            {
                yield return Application.RequestUserAuthorization(UserAuthorization.WebCam);
                if (ticket != generation || !requested) yield break;
                if (!Application.HasUserAuthorization(UserAuthorization.WebCam))
                {
                    Fail("No se autorizó la cámara. El modo 3D sigue disponible.");
                    yield break;
                }
            }
#endif
            var devices = WebCamTexture.devices;
            if (devices.Length == 0)
            {
                Fail("No se encontró una cámara disponible. Continúa en modo 3D.");
                yield break;
            }
            string deviceName = null;
            foreach (var device in devices)
            {
                if (!device.isFrontFacing) { deviceName = device.name; break; }
            }
#if UNITY_ANDROID && !UNITY_EDITOR
            if (deviceName == null)
            {
                Fail("No se encontró una cámara trasera disponible para el marcador.");
                yield break;
            }
#else
            if (deviceName == null) deviceName = devices[0].name;
#endif
            webcam = new WebCamTexture(deviceName, 640, 480, 30);
            webcam.Play();
            float firstFrameDeadline = Time.realtimeSinceStartup + 15f;
            while (ticket == generation && requested &&
                (!webcam.isPlaying || webcam.width <= 16 || webcam.height <= 16 || !webcam.didUpdateThisFrame))
            {
                if (Time.realtimeSinceStartup >= firstFrameDeadline)
                {
                    Fail("Sin imágenes de cámara. Revisa permisos y cierra otras apps de cámara.");
                    yield break;
                }
                yield return null;
            }
            if (ticket != generation || !requested) yield break;
            backgroundMaterial.mainTexture = webcam;
            ConfigureImageGeometry(true);
            background.SetActive(true);
            IsRunning = true;
            lastCameraFrame = Time.unscaledTime;
            nextDetection = Time.unscaledTime;
            Status = "Apunta al marcador completo, con margen blanco y buena luz.";
        }

        private void Update()
        {
            if (!IsRunning || webcam == null || applicationPaused) return;
            if (!webcam.isPlaying || Time.unscaledTime - lastCameraFrame > FrameTimeoutSeconds)
            {
                Fail("La cámara se detuvo. Vuelve a 3D e intenta abrirla de nuevo.");
                return;
            }
            if (IsTracking && Time.unscaledTime - lastObservation > StalePoseSeconds) LoseMarker();
            if (!webcam.didUpdateThisFrame) return;
            lastCameraFrame = Time.unscaledTime;
            try
            {
                ConfigureImageGeometry(false);
                if (Time.unscaledTime < nextDetection) return;
                nextDetection = Time.unscaledTime + DetectionInterval;
                DetectCurrentFrame();
            }
            catch (Exception exception)
            {
                Debug.LogException(exception);
                Fail("No se pudo procesar la cámara. Puedes continuar con el modo 3D.");
            }
        }

        private void ConfigureImageGeometry(bool force)
        {
            int cameraRotation = ((webcam.videoRotationAngle % 360) + 360) % 360;
            bool cameraMirrored = webcam.videoVerticallyMirrored;
            if (!force && rawWidth == webcam.width && rawHeight == webcam.height && rotation == cameraRotation &&
                mirrored == cameraMirrored && configuredScreenWidth == Screen.width && configuredScreenHeight == Screen.height) return;

            rawWidth = webcam.width;
            rawHeight = webcam.height;
            rotation = cameraRotation;
            mirrored = cameraMirrored;
            configuredScreenWidth = Mathf.Max(1, Screen.width);
            configuredScreenHeight = Mathf.Max(1, Screen.height);
            CameraFrameMapping.GetUprightSize(rawWidth, rawHeight, rotation, out uprightWidth, out uprightHeight);
            float ratio = Mathf.Min(1f, MaximumDetectionDimension / (float)Mathf.Max(uprightWidth, uprightHeight));
            detectionWidth = Mathf.Max(1, Mathf.RoundToInt(uprightWidth * ratio));
            detectionHeight = Mathf.Max(1, Mathf.RoundToInt(uprightHeight * ratio));
            int count = detectionWidth * detectionHeight;
            if (grayscale == null || grayscale.Length != count)
            {
                grayscale = new byte[count];
                sourceIndices = new int[count];
            }
            if (cameraPixels == null || cameraPixels.Length != rawWidth * rawHeight) cameraPixels = new Color32[rawWidth * rawHeight];
            for (int y = 0; y < detectionHeight; y++)
            {
                int sourceY = Mathf.Clamp(Mathf.RoundToInt((y + 0.5f) * uprightHeight / detectionHeight - 0.5f), 0, uprightHeight - 1);
                for (int x = 0; x < detectionWidth; x++)
                {
                    int sourceX = Mathf.Clamp(Mathf.RoundToInt((x + 0.5f) * uprightWidth / detectionWidth - 0.5f), 0, uprightWidth - 1);
                    sourceIndices[y * detectionWidth + x] = CameraFrameMapping.GetRawPixelIndex(sourceX, sourceY, rawWidth, rawHeight, rotation, mirrored);
                }
            }

            // The same center-of-pixel downsample is applied to both observation coordinates and K.
            double focal = Math.Max(uprightWidth, uprightHeight) / (2.0 * Math.Tan(EstimatedLongSideFov * Math.PI / 360.0));
            double sx = (double)detectionWidth / uprightWidth;
            double sy = (double)detectionHeight / uprightHeight;
            double cx = (uprightWidth - 1) * 0.5;
            double cy = (uprightHeight - 1) * 0.5;
            detectionIntrinsics = new CameraIntrinsics(focal * sx, focal * sy,
                (cx + 0.5) * sx - 0.5, (cy + 0.5) * sy - 0.5);

            float fillScale = Mathf.Max(configuredScreenWidth / (float)uprightWidth, configuredScreenHeight / (float)uprightHeight);
            float screenFocal = (float)focal * fillScale;
            ViewCamera.aspect = configuredScreenWidth / (float)configuredScreenHeight;
            ViewCamera.fieldOfView = 2f * Mathf.Atan(configuredScreenHeight / (2f * screenFocal)) * Mathf.Rad2Deg;
            ViewCamera.ResetProjectionMatrix();
            float visibleHeight = 2f * BackgroundDistance * Mathf.Tan(ViewCamera.fieldOfView * 0.5f * Mathf.Deg2Rad);
            float sourceHeight = visibleHeight * uprightHeight * fillScale / configuredScreenHeight;
            float sourceWidth = sourceHeight * uprightWidth / uprightHeight;
            backgroundMesh.Clear();
            backgroundMesh.vertices = new[]
            {
                new Vector3(-sourceWidth * 0.5f, -sourceHeight * 0.5f, BackgroundDistance),
                new Vector3(-sourceWidth * 0.5f, sourceHeight * 0.5f, BackgroundDistance),
                new Vector3(sourceWidth * 0.5f, sourceHeight * 0.5f, BackgroundDistance),
                new Vector3(sourceWidth * 0.5f, -sourceHeight * 0.5f, BackgroundDistance)
            };
            backgroundMesh.uv = new[] { RawUv(0, 1), RawUv(0, 0), RawUv(1, 0), RawUv(1, 1) };
            backgroundMesh.triangles = new[] { 0, 1, 2, 0, 2, 3 };
            backgroundMesh.RecalculateBounds();
            ResetPose();
        }

        private Vector2 RawUv(double u, double v)
        {
            ImagePoint point = CameraFrameMapping.MapUprightToRawUv(u, v, rotation, mirrored);
            return new Vector2((float)point.X, (float)point.Y);
        }

        private void DetectCurrentFrame()
        {
            cameraPixels = webcam.GetPixels32(cameraPixels);
            for (int i = 0; i < grayscale.Length; i++)
            {
                Color32 pixel = cameraPixels[sourceIndices[i]];
                grayscale[i] = (byte)((77 * pixel.r + 150 * pixel.g + 29 * pixel.b) >> 8);
            }
            if (!detector.TryDetect(grayscale, detectionWidth, detectionHeight, out MarkerObservation observation) ||
                !MarkerPoseEstimator.TryEstimate(observation, detectionIntrinsics, MarkerDefinition.WidthMeters, out MarkerPose pose) ||
                pose.Z < 0.10 || pose.Z > 3.5)
            {
                LoseMarker();
                return;
            }

            double[] r = pose.Rotation;
            Vector3 position = ViewCamera.transform.TransformPoint(new Vector3((float)pose.X, (float)-pose.Y, (float)pose.Z));
            Vector3 forward = ViewCamera.transform.TransformDirection(new Vector3((float)-r[1], (float)r[4], (float)-r[7]));
            Vector3 up = ViewCamera.transform.TransformDirection(new Vector3((float)-r[2], (float)r[5], (float)-r[8]));
            if (forward.sqrMagnitude < 0.9f || up.sqrMagnitude < 0.9f) { LoseMarker(); return; }
            Quaternion orientation = Quaternion.LookRotation(forward, up);
            float now = Time.unscaledTime;
            if (!hasPose)
            {
                filteredPosition = position;
                filteredRotation = orientation;
                hasPose = true;
                consecutiveObservations = 1;
            }
            else
            {
                // Do not connect an implausible one-frame jump to the previous marker pose.
                if (Vector3.Distance(filteredPosition, position) > 0.35f || Quaternion.Angle(filteredRotation, orientation) > 85f)
                {
                    ResetPose();
                    filteredPosition = position;
                    filteredRotation = orientation;
                    hasPose = true;
                    consecutiveObservations = 1;
                }
                else
                {
                    float elapsed = Mathf.Clamp(now - lastPoseUpdate, 0.001f, 0.25f);
                    float blend = 1f - Mathf.Exp(-18f * elapsed);
                    filteredPosition = Vector3.Lerp(filteredPosition, position, blend);
                    filteredRotation = Quaternion.Slerp(filteredRotation, orientation, blend);
                    consecutiveObservations++;
                }
            }
            lastPoseUpdate = now;
            lastObservation = now;
            if (consecutiveObservations < 2)
            {
                Status = "Marcador detectado · confirmando seguimiento…";
                return;
            }
            bool wasTracking = IsTracking;
            IsTracking = true;
            content.SetPositionAndRotation(filteredPosition, filteredRotation);
            content.localScale = originalScale * ContentScale;
            content.gameObject.SetActive(true);
            // Touch raycasts run later in Update; physics normally syncs only
            // before a fixed simulation step, so publish this camera pose now.
            Physics.SyncTransforms();
            Status = "Marcador visible · toca la red y mantén la imagen en cámara.";
            if (!wasTracking) TrackingFound?.Invoke();
        }

        private void LoseMarker()
        {
            ResetPose();
            Status = "Marcador fuera de vista · muestra el cuadrado completo con buena luz.";
        }

        private void ResetPose()
        {
            IsTracking = false;
            hasPose = false;
            consecutiveObservations = 0;
            lastObservation = float.NegativeInfinity;
            lastPoseUpdate = float.NegativeInfinity;
            if (content != null) content.gameObject.SetActive(false);
        }

        private void Fail(string message)
        {
            requested = false;
            ReleaseCapture();
            Status = message;
            Failed?.Invoke(message);
        }

        private void ReleaseCapture()
        {
            ++generation;
            starting = false;
            IsRunning = false;
            // Invalidating the generation cancels startup on its next continuation.
            // Do not StopCoroutine from Fail: Fail can run inside that coroutine.
            ResetPose();
            if (webcam != null)
            {
                if (webcam.isPlaying) webcam.Stop();
                Destroy(webcam);
                webcam = null;
            }
            if (backgroundMaterial != null) backgroundMaterial.mainTexture = null;
            if (background != null) background.SetActive(false);
            if (cameraRoot != null) cameraRoot.SetActive(false);
            if (content != null) content.localScale = originalScale;
        }

        private void OnApplicationPause(bool paused)
        {
            applicationPaused = paused;
            if (!initialized) return;
            if (paused)
            {
                // This component also exists while the app is exploring in 3D.
                // An idle camera must not hide that mode's shared content on pause.
                if (!requested && !starting && !IsRunning) return;
                bool keepRequest = requested;
                ReleaseCapture();
                requested = keepRequest;
                Status = "Cámara en pausa · buscaré el marcador al volver.";
            }
            else if (requested && isActiveAndEnabled) BeginStartup();
        }

        private void OnEnable()
        {
            if (initialized && requested && !applicationPaused) BeginStartup();
        }

        private void OnDisable()
        {
            if (initialized && (requested || starting || IsRunning)) ReleaseCapture();
        }

        private void OnDestroy()
        {
            requested = false;
            ReleaseCapture();
            if (backgroundMesh != null) Destroy(backgroundMesh);
            if (backgroundMaterial != null) Destroy(backgroundMaterial);
            if (cameraRoot != null) Destroy(cameraRoot);
        }
    }
}
