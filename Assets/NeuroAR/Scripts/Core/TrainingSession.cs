using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;

namespace NeuroAR.Core
{
    /// <summary>
    /// Owns recorded training states. Scrubbing restores exact parameters; stepping
    /// first replays recorded states and trains only at the end of the history.
    /// Use EditWeight/EditBias for manual changes so future history stays valid.
    /// </summary>
    public sealed class TrainingSession
    {
        private readonly List<NetworkParameters> history = new List<NetworkParameters>();
        private readonly List<float> losses = new List<float>();
        private readonly ReadOnlyCollection<float> readOnlyLosses;

        public TinyNetwork Network { get; private set; }
        public int HistoryIndex { get; private set; }
        public int HistoryCount { get { return history.Count; } }
        public IReadOnlyList<float> Losses { get { return readOnlyLosses; } }

        public TrainingSession()
        {
            readOnlyLosses = losses.AsReadOnly();
            Reset();
        }

        /// <summary>
        /// Replays one recorded state, or trains and records at most 'epochs' new
        /// epochs. maximumEpoch caps newly trained states, not historical replay.
        /// Returns false only when there is no next state and the cap is reached.
        /// </summary>
        public bool Step(int epochs = 10, int maximumEpoch = 4000)
        {
            if (epochs <= 0) throw new ArgumentOutOfRangeException(nameof(epochs), "A step must contain at least one epoch.");
            if (maximumEpoch < 0) throw new ArgumentOutOfRangeException(nameof(maximumEpoch));
            if (HistoryIndex < history.Count - 1)
            {
                Network.Restore(history[++HistoryIndex]);
                return true;
            }
            if (Network.Epoch >= maximumEpoch) return false;
            for (int i = 0; i < epochs && Network.Epoch < maximumEpoch; i++) Network.TrainEpoch();
            Record();
            return true;
        }

        /// <summary>Clamps any requested index to the available history range.</summary>
        public void Scrub(int index)
        {
            HistoryIndex = Math.Min(Math.Max(index, 0), history.Count - 1);
            Network.Restore(history[HistoryIndex]);
        }

        public void Reset()
        {
            Network = new TinyNetwork();
            history.Clear();
            losses.Clear();
            Record();
        }

        public void EditWeight(int layer, int target, int source, double value)
        {
            Network.SetWeight(layer, target, source, value);
            RecordEdit();
        }

        public void EditBias(int layer, int target, double value)
        {
            Network.SetBias(layer, target, value);
            RecordEdit();
        }

        private void Record()
        {
            history.Add(Network.Capture());
            losses.Add((float)Network.Loss);
            HistoryIndex = history.Count - 1;
        }

        private void RecordEdit()
        {
            int future = history.Count - HistoryIndex - 1;
            if (future > 0)
            {
                history.RemoveRange(HistoryIndex + 1, future);
                losses.RemoveRange(HistoryIndex + 1, future);
            }
            history[HistoryIndex] = Network.Capture();
            losses[HistoryIndex] = (float)Network.Loss;
        }
    }
}
