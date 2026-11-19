using NeuroAR.App;
using UnityEngine;

namespace NeuroAR.AR
{
    /// <summary>Small serialized scene entry point; the app builds its own runtime interface.</summary>
    [DefaultExecutionOrder(-1000)]
    public sealed class NeuroArBootstrap : MonoBehaviour
    {
        private void Awake()
        {
            Application.targetFrameRate = 60;
            Screen.sleepTimeout = SleepTimeout.NeverSleep;
            // A direct generic reference also keeps the entry point alive in IL2CPP builds.
            if (GetComponent<NeuroArApp>() == null)
                gameObject.AddComponent<NeuroArApp>();
        }
    }
}
