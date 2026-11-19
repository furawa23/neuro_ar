using System;
using System.Globalization;
using NeuroAR.AR;
using NeuroAR.Core;
using NeuroAR.Visualization;
using UnityEngine;

namespace NeuroAR.App
{
    /// <summary>Connects the educational model, its spatial view and the touch interface.</summary>
    public sealed class NeuroArApp : MonoBehaviour
    {
        private const int EpochsPerStep = 10;
        private const int MaximumEpoch = 4000;
        private TrainingSession session;
        private TinyNetwork network { get { return session.Network; } }
        private NetworkView view;
        private ArPlacementController placement;
        private LabUi ui;
        private int sampleIndex = 2;
        private int selectedLayer = 1;
        private int selectedIndex;
        private int selectedSource;
        private bool connectionSelected;
        private bool playing;
        private float nextStep;
        private Camera currentCamera;

        private static readonly double[,] Samples = { { 0, 0, 0 }, { 0, 1, 1 }, { 1, 0, 1 }, { 1, 1, 0 } };
        private static string N(double value) { return value.ToString("0.000", CultureInfo.InvariantCulture); }

        private void Awake()
        {
            Application.targetFrameRate = 60;
            Screen.sleepTimeout = SleepTimeout.NeverSleep;
            session = new TrainingSession();
            var content = new GameObject("NetworkContent");
            view = content.AddComponent<NetworkView>();
            placement = gameObject.AddComponent<ArPlacementController>();
            placement.Initialize(content.transform);
            currentCamera = placement.ViewCamera;
            view.Initialize(currentCamera);
            view.NeuronSelected += SelectNeuron;
            view.ConnectionSelected += SelectConnection;
            ui = gameObject.AddComponent<LabUi>();
            ui.Initialize();
            placement.ConfigurePreviewViewport(ui.PreviewViewport);
            ui.ModeRequested += ToggleMode;
            ui.RepositionRequested += placement.Reposition;
            ui.SampleRequested += SelectSample;
            ui.PlayRequested += TogglePlayback;
            ui.StepRequested += () => { Pause(); Step(); };
            ui.ResetRequested += ResetNetwork;
            ui.PulseRequested += view.Pulse;
            ui.ParameterChanged += EditParameter;
            ui.HistoryChanged += Scrub;
            Refresh();
            view.SelectNeuron(1, 0);
        }

        private void Update()
        {
            if (placement == null || ui == null) return;
            placement.ConfigurePreviewViewport(ui.PreviewViewport);
            if (placement.ViewCamera != currentCamera)
            {
                currentCamera = placement.ViewCamera;
                view.SetCamera(currentCamera);
            }
            view.InteractionEnabled = !placement.IsArMode || placement.IsPlaced;
            ui.SetSpatialState(placement.IsArMode, placement.IsPlaced, placement.Status);
            if (playing && Time.unscaledTime >= nextStep)
            {
                nextStep = Time.unscaledTime + 0.12f;
                Step();
            }
            if (Input.GetKeyDown(KeyCode.Escape)) Pause();
        }

        private void ToggleMode()
        {
            Pause();
            placement.SetArMode(!placement.IsArMode);
            currentCamera = placement.ViewCamera;
            view.SetCamera(currentCamera);
        }

        private void TogglePlayback()
        {
            playing = !playing;
            nextStep = Time.unscaledTime;
            ui.SetPlaying(playing);
        }

        private void Pause()
        {
            playing = false;
            if (ui != null) ui.SetPlaying(false);
        }

        private void Step()
        {
            if (!session.Step(EpochsPerStep, MaximumEpoch)) { Pause(); return; }
            Refresh();
        }

        private void Scrub(int index)
        {
            Pause();
            session.Scrub(index);
            Refresh();
        }

        private void ResetNetwork()
        {
            Pause();
            session.Reset();
            Refresh();
        }

        private void SelectSample(int index)
        {
            sampleIndex = Mathf.Clamp(index, 0, 3);
            Refresh();
            view.Pulse();
        }

        private void SelectNeuron(int layer, int index)
        {
            connectionSelected = false;
            selectedLayer = layer;
            selectedIndex = index;
            RefreshInspector(network.Evaluate(Samples[sampleIndex, 0], Samples[sampleIndex, 1]));
        }

        private void SelectConnection(int layer, int target, int source)
        {
            connectionSelected = true;
            selectedLayer = layer;
            selectedIndex = target;
            selectedSource = source;
            RefreshInspector(network.Evaluate(Samples[sampleIndex, 0], Samples[sampleIndex, 1]));
        }

        private void EditParameter(float value)
        {
            Pause();
            if (selectedLayer == 0) return;
            if (connectionSelected) session.EditWeight(selectedLayer, selectedIndex, selectedSource, value);
            else session.EditBias(selectedLayer, selectedIndex, value);
            Refresh();
        }

        private void Refresh()
        {
            var snapshot = network.Evaluate(Samples[sampleIndex, 0], Samples[sampleIndex, 1]);
            view.Render(network, snapshot);
            ui.SetSample(sampleIndex, (float)snapshot.Output, (int)Samples[sampleIndex, 2]);
            ui.SetTraining(network.Epoch, (float)network.Loss, session.HistoryIndex, session.HistoryCount - 1, session.Losses);
            RefreshInspector(snapshot);
        }

        private void RefreshInspector(NetworkSnapshot snapshot)
        {
            if (connectionSelected)
            {
                double input = selectedLayer == 1 ? snapshot.Inputs[selectedSource] : snapshot.HiddenActivations[selectedSource];
                double weight = network.GetWeight(selectedLayer, selectedIndex, selectedSource);
                string from = selectedLayer == 1 ? "x" + (selectedSource + 1) : "h" + (selectedSource + 1);
                string to = selectedLayer == 1 ? "h" + (selectedIndex + 1) : "y";
                ui.SetInspector("CONEXIÓN · " + from + " → " + to, "Peso " + N(weight),
                    "Entrada " + N(input) + "   ×   peso " + N(weight) + "\nAporte a la suma: " + N(input * weight),
                    "El signo indica si esta conexión suma o resta. Su magnitud controla cuánto influye.",
                    "Modificar peso", (float)weight, true);
                return;
            }
            if (selectedLayer == 0)
            {
                ui.SetInspector("CAPA DE ENTRADA", "Entrada x" + (selectedIndex + 1),
                    "Valor del ejemplo: " + N(snapshot.Inputs[selectedIndex]) + "\nEsta entrada se conecta a las cuatro neuronas ocultas.",
                    "Las entradas contienen los datos del ejemplo. Cambia de ejemplo en la fila superior.",
                    "Selecciona un parámetro para editar", 0, false);
                return;
            }
            bool hidden = selectedLayer == 1;
            double sum = hidden ? snapshot.HiddenSums[selectedIndex] : snapshot.OutputSum;
            double output = hidden ? snapshot.HiddenActivations[selectedIndex] : snapshot.Output;
            double bias = network.GetBias(selectedLayer, selectedIndex);
            ui.SetInspector(hidden ? "CAPA OCULTA · h" + (selectedIndex + 1) : "CAPA DE SALIDA · y",
                (hidden ? "tanh" : "Sigmoide") + "  →  " + N(output),
                "Suma ponderada + sesgo = " + N(sum) + "\nSesgo " + N(bias) + "   ·   Activación " + N(output),
                hidden ? "Cada neurona combina entradas y transforma la suma. Toca una conexión para explorar su peso."
                    : "La salida estima la clase 1. Desde 0.5 se interpreta como 1; por debajo, como 0.",
                "Modificar sesgo", (float)bias, true);
        }
    }
}
