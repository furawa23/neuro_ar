using UnityEngine;

namespace NeuroAR.Visualization
{
    /// <summary>Identifies a diagram object without depending on names or hierarchy paths.</summary>
    [AddComponentMenu("")]
    public sealed class NetworkPickTarget : MonoBehaviour
    {
        public NetworkView Owner { get; internal set; }
        public bool IsConnection { get; internal set; }
        public int Layer { get; internal set; }
        public int Target { get; internal set; }
        public int Source { get; internal set; }
    }
}
