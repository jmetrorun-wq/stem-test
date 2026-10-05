Pod::Spec.new do |s|
  s.name           = 'StemDsp'
  s.version        = '1.0.0'
  s.summary        = 'STFT / iSTFT htdemucs avec Accelerate'
  s.description    = 'Pré et post-traitement de la séparation de pistes, en natif.'
  s.author         = ''
  s.homepage       = 'https://github.com/jmetrorun-wq/stem-test'
  s.license        = 'MIT'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'Accelerate'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = '**/*.{h,m,mm,swift}'
end
