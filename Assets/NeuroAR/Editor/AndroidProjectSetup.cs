using System;
using System.IO;
using NeuroAR.AR;
using UnityEditor;
using UnityEditor.Build;
using UnityEditor.Build.Reporting;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;

namespace NeuroAR.Editor
{
    /// <summary>Reproducible Android configuration, scene setup and debug APK build entry point.</summary>
    [InitializeOnLoad]
    public static class AndroidProjectSetup
    {
        public const string ScenePath = "Assets/NeuroAR/Scenes/NeuroAR.unity";
        private const string StampPath = "ProjectSettings/NeuroARSetup.txt";
        private const string SetupStamp = "NeuroAR marker setup 2";
        private const string PendingBuildKey = "NeuroAR.BuildAndroidAfterReload";

        static AndroidProjectSetup()
        {
            EditorApplication.delayCall += () =>
            {
                if (EditorApplication.isCompiling || EditorApplication.isUpdating)
                {
                    EditorApplication.delayCall += InitializeWhenReady;
                    return;
                }
                InitializeWhenReady();
            };
        }

        private static void InitializeWhenReady()
        {
            if (EditorApplication.isCompiling || EditorApplication.isUpdating)
            {
                EditorApplication.delayCall += InitializeWhenReady;
                return;
            }
            if (EditorApplication.isPlayingOrWillChangePlaymode) return;
            if (!File.Exists(StampPath) || !File.ReadAllText(StampPath).Contains(SetupStamp)) PrepareProject();
            if (SessionState.GetBool(PendingBuildKey, false))
            {
                SessionState.SetBool(PendingBuildKey, false);
                if (EditorUserBuildSettings.activeBuildTarget == BuildTarget.Android) BuildApk();
            }
        }

        [MenuItem("NeuroAR/Preparar proyecto Android")]
        public static void PrepareProject()
        {
            PlayerSettings.companyName = "NeuroAR Educativo";
            PlayerSettings.productName = "NeuroAR";
            PlayerSettings.bundleVersion = "0.2.0";
            PlayerSettings.SetApplicationIdentifier(NamedBuildTarget.Android, "com.neuroar.educativo");
            PlayerSettings.SetScriptingBackend(NamedBuildTarget.Android, ScriptingImplementation.IL2CPP);
            PlayerSettings.Android.targetArchitectures = AndroidArchitecture.ARM64;
            PlayerSettings.Android.minSdkVersion = AndroidSdkVersions.AndroidApiLevel24;
            PlayerSettings.Android.targetSdkVersion = AndroidSdkVersions.AndroidApiLevelAuto;
            PlayerSettings.Android.bundleVersionCode = 2;
            PlayerSettings.Android.useCustomKeystore = false;
            PlayerSettings.defaultInterfaceOrientation = UIOrientation.Portrait;
            PlayerSettings.allowedAutorotateToPortrait = true;
            PlayerSettings.allowedAutorotateToPortraitUpsideDown = false;
            PlayerSettings.allowedAutorotateToLandscapeLeft = false;
            PlayerSettings.allowedAutorotateToLandscapeRight = false;
            PlayerSettings.colorSpace = ColorSpace.Linear;
            GraphicsSettings.defaultRenderPipeline = null;
            QualitySettings.renderPipeline = null;
            PlayerSettings.SetUseDefaultGraphicsAPIs(BuildTarget.Android, false);
            PlayerSettings.SetGraphicsAPIs(BuildTarget.Android, new[] { GraphicsDeviceType.OpenGLES3 });
            PlayerSettings.graphicsJobs = false;
            PlayerSettings.stripEngineCode = false;
            EditorUserBuildSettings.buildAppBundle = false;
            SetLegacyInput();
            IncludeRuntimeShaders();
            EnsureScene();
            EditorBuildSettings.scenes = new[] { new EditorBuildSettingsScene(ScenePath, true) };
            File.WriteAllText(StampPath, SetupStamp + "\nUnity 6000.0.62f1; seguimiento visual del marcador NeuroAR de 14 cm\n");
            AssetDatabase.SaveAssets();
            Debug.Log("NeuroAR preparado: Android ARM64, cámara y marcador impreso. Abre NeuroAR.unity y pulsa Play.");
        }

        private static void SetLegacyInput()
        {
            // UI and orbit controls use legacy touch input; marker pose is computed from camera frames.
            var settings = new SerializedObject(Unsupported.GetSerializedAssetInterfaceSingleton("PlayerSettings"));
            var input = settings.FindProperty("activeInputHandler");
            if (input != null && input.intValue != 0)
            {
                input.intValue = 0;
                settings.ApplyModifiedPropertiesWithoutUndo();
            }
        }

        private static void IncludeRuntimeShaders()
        {
            var asset = Unsupported.GetSerializedAssetInterfaceSingleton("GraphicsSettings");
            if (asset == null) return;
            var serialized = new SerializedObject(asset);
            var shaders = serialized.FindProperty("m_AlwaysIncludedShaders");
            if (shaders == null) return;
            foreach (var name in new[] { "Unlit/Color", "Unlit/Texture", "Sprites/Default", "UI/Default" })
            {
                var shader = Shader.Find(name);
                if (shader == null) throw new BuildFailedException("No se encontró el shader integrado " + name);
                var exists = false;
                for (var index = 0; index < shaders.arraySize; index++)
                    if (shaders.GetArrayElementAtIndex(index).objectReferenceValue == shader) exists = true;
                if (exists) continue;
                shaders.InsertArrayElementAtIndex(shaders.arraySize);
                shaders.GetArrayElementAtIndex(shaders.arraySize - 1).objectReferenceValue = shader;
            }
            serialized.ApplyModifiedPropertiesWithoutUndo();
        }

        private static void EnsureScene()
        {
            if (File.Exists(ScenePath)) return;
            Directory.CreateDirectory(Path.GetDirectoryName(ScenePath));
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Additive);
            var root = new GameObject("NeuroAR");
            UnityEngine.SceneManagement.SceneManager.MoveGameObjectToScene(root, scene);
            root.AddComponent<NeuroArBootstrap>();
            EditorSceneManager.SaveScene(scene, ScenePath);
            EditorSceneManager.CloseScene(scene, true);
        }

        [MenuItem("NeuroAR/Compilar APK Android")]
        public static void BuildApk()
        {
            if (!BuildPipeline.IsBuildTargetSupported(BuildTargetGroup.Android, BuildTarget.Android))
                throw new BuildFailedException("Instala Android Build Support, Android SDK & NDK Tools y OpenJDK desde Unity Hub.");
            PrepareProject();
            if (EditorUserBuildSettings.activeBuildTarget != BuildTarget.Android)
            {
                SessionState.SetBool(PendingBuildKey, true);
                if (!EditorUserBuildSettings.SwitchActiveBuildTarget(BuildTargetGroup.Android, BuildTarget.Android))
                {
                    SessionState.SetBool(PendingBuildKey, false);
                    throw new BuildFailedException("No se pudo cambiar el destino a Android.");
                }
                return;
            }
            var output = GetOutputPath();
            Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(output)));
            var report = BuildPipeline.BuildPlayer(new BuildPlayerOptions
            {
                scenes = new[] { ScenePath },
                locationPathName = output,
                target = BuildTarget.Android,
                options = BuildOptions.Development
            });
            if (report.summary.result != BuildResult.Succeeded)
                throw new BuildFailedException("No se generó el APK. Consulta los errores del registro de Unity.");
            Debug.Log("APK de desarrollo generado: " + Path.GetFullPath(output));
        }

        private static string GetOutputPath()
        {
            var arguments = Environment.GetCommandLineArgs();
            for (var index = 0; index < arguments.Length - 1; index++)
                if (arguments[index] == "-neuroarOutput") return arguments[index + 1];
            return "Builds/Android/NeuroAR.apk";
        }
    }
}
